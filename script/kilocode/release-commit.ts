import { $ } from "bun"

/**
 * Whether an earlier run of the publish job already pushed the release commit and tag for
 * `version`, so that a re-run continues without committing, tagging or pushing again.
 *
 * True only when tag v<version> exists on origin, points at a commit reachable from
 * origin/main, and that commit's packages/opencode/package.json has `version`. A tag that
 * exists but is anything else fails the run: it is not this release's commit.
 */
export async function pushed(version: string) {
  const tag = `v${version}`
  // --exit-code: 2 when no ref matches, 0 when one does.
  const remote = await $`git ls-remote --exit-code --tags origin refs/tags/${tag}`.quiet().nothrow()
  if (remote.exitCode === 2) return false
  if (remote.exitCode !== 0) throw new Error(`git ls-remote failed for ${tag}: ${remote.stderr.toString()}`)

  await $`git fetch --no-tags --depth=1 origin +refs/tags/${tag}:refs/tags/${tag}`.quiet()
  const commit = `${tag}^{commit}`
  const sha = (await $`git rev-parse ${commit}`.text()).trim()
  const repo = process.env.GH_REPO
  if (!repo) throw new Error("GH_REPO is required to check the release tag")
  // compare/<tag commit>...main is "ahead" or "identical" when main contains the tag commit.
  const status = (await $`gh api repos/${repo}/compare/${sha}...main --jq .status`.text()).trim()
  if (status !== "ahead" && status !== "identical") {
    throw new Error(`Tag ${tag} points at ${sha}, which is not on main (compare status ${status}). Nothing was pushed.`)
  }
  const found = JSON.parse(await $`git show ${sha}:packages/opencode/package.json`.text()).version
  if (found !== version) {
    throw new Error(
      `Tag ${tag} points at ${sha}, whose packages/opencode/package.json has version ${found}. Nothing was pushed.`,
    )
  }
  return true
}
