import { $ } from "bun"

function repo() {
  const value = process.env.GH_REPO
  if (!value) throw new Error("GH_REPO is required to check the release commit")
  return value
}

/** The version in packages/opencode/package.json at `sha`, fetching that commit if needed. */
async function packaged(sha: string) {
  await $`git fetch --no-tags --depth=1 origin ${sha}`.quiet()
  return JSON.parse(await $`git show ${sha}:packages/opencode/package.json`.text()).version
}

/**
 * The newest of the last 100 commits on main whose subject is `release: <tag>`. A re-run that
 * finds the release commit without its tag runs soon after the failed run, so the commit is
 * among them.
 */
async function commit(tag: string) {
  // Interpolated, so that the shell does not read `[]`, `?` and `&` as globs or operators.
  const [jq, endpoint] = [".[]", `repos/${repo()}/commits?sha=main&per_page=100`]
  const commits: { sha: string; commit: { message: string } }[] = (await $`gh api --jq ${jq} ${endpoint}`.text())
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line))
  return commits.find((item) => item.commit.message.split("\n")[0] === `release: ${tag}`)?.sha
}

/**
 * Whether an earlier run of the publish job already pushed the release commit for `version`,
 * so that a re-run continues without committing or pushing it again.
 *
 * True when tag v<version> exists on origin, points at a commit reachable from main, and that
 * commit's packages/opencode/package.json has `version`; a tag that is anything else fails the
 * run. Also true when the tag is missing but the release commit (subject `release: v<version>`,
 * with that version) is on main: the tag is then created on that commit and pushed.
 */
export async function pushed(version: string) {
  const tag = `v${version}`
  // --exit-code: 2 when no ref matches, 0 when one does.
  const remote = await $`git ls-remote --exit-code --tags origin refs/tags/${tag}`.quiet().nothrow()
  if (remote.exitCode !== 0 && remote.exitCode !== 2) {
    throw new Error(`git ls-remote failed for ${tag}: ${remote.stderr.toString()}`)
  }

  if (remote.exitCode === 2) {
    const sha = await commit(tag)
    if (!sha) return false
    const found = await packaged(sha)
    if (found !== version) {
      throw new Error(`Commit ${sha} "release: ${tag}" on main has version ${found}. Nothing was pushed.`)
    }
    await $`git tag ${tag} ${sha}`
    await $`git push origin refs/tags/${tag}`
    console.log(`release commit ${sha} for ${tag} was on main without its tag; tagged it and pushed the tag`)
    return true
  }

  await $`git fetch --no-tags --depth=1 origin +refs/tags/${tag}:refs/tags/${tag}`.quiet()
  const ref = `${tag}^{commit}`
  const sha = (await $`git rev-parse ${ref}`.text()).trim()
  // compare/<tag commit>...main is "ahead" or "identical" when main contains the tag commit.
  const status = (await $`gh api repos/${repo()}/compare/${sha}...main --jq .status`.text()).trim()
  if (status !== "ahead" && status !== "identical") {
    throw new Error(`Tag ${tag} points at ${sha}, which is not on main (compare status ${status}). Nothing was pushed.`)
  }
  const found = await packaged(sha)
  if (found !== version) {
    throw new Error(
      `Tag ${tag} points at ${sha}, whose packages/opencode/package.json has version ${found}. Nothing was pushed.`,
    )
  }
  return true
}
