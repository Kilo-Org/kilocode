#!/usr/bin/env bun
// kilocode_change - new file
/**
 * Pushes the release commit and its tag in the release-push job of .github/workflows/publish.yml.
 *
 * The job runs in the release-keys environment with a Kilo Maintainer app token (served by the git
 * credential helper of setup-git-committer) and installs nothing: this script imports only Node and
 * Bun built-ins and this repository's release-check.ts.
 *
 *   bun script/kilocode/release-push.ts <release.bundle>
 *
 * Environment: BUNDLE_SHA256 (the release-commit job's output), VERSION and BASE (the dispatch
 * commit, github.sha). Writes `commit` (the pushed release commit, which the tag names) to
 * GITHUB_OUTPUT.
 *
 * 1. The bundle must have that sha256 and hold exactly the tag `v<version>`, naming a commit (no tag
 *    object) whose only parent is BASE and whose subject is `release: v<version>`. Its objects are
 *    fetched with fsck checks.
 * 2. release-check.ts compares the full trees of BASE and that commit.
 * 3. Only the tree comes from the bundle: this script writes the release commit itself (tree, parent
 *    BASE, subject `release: v<version>`, the kilo-maintainer[bot] identity, and the bundle commit's
 *    timestamp, so a re-run writes the same commit).
 * 4. The tag on origin: naming this commit, the run pushes nothing; naming anything else, it is
 *    refused; missing, the push goes ahead.
 * 5. When main is still BASE, main fast-forwards to the commit. Otherwise git merges main and the
 *    commit (merge-tree and commit-tree only; a conflict refuses the run) and release-check.ts
 *    compares main with the merge, so only the release lines and paths change on main.
 * 6. main and the tag are pushed with one atomic push whose lease pins main to the merged head. When
 *    the push fails, both refs are read back: main and the tag already at the pushed commits count as
 *    pushed; main unchanged retries the same push (at most twice, 3 s apart); main moved elsewhere is
 *    merged again (at most twice).
 */

import { $ } from "bun"
import { createHash } from "node:crypto"
import { appendFile, readFile } from "node:fs/promises"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { check, IDENTITY, shape } from "./release-check"
export type Input = {
  /** The repository whose `origin` receives the push. */
  cwd: string
  bundle: string
  sha256: string
  version: string
  base: string
  /** Called before each push attempt; tests move main or push the refs here. */
  before?: (attempt: number, refs: { head: string; target: string; commit: string }) => Promise<void>
  /** Milliseconds between two pushes of the same refs (default 3000). */
  wait?: number
}

export async function push(input: Input) {
  const { cwd, bundle, version, base } = input
  const tag = `v${version}`
  // A shell of its own, so the default working directory of other Bun shell users stays as it is.
  const git = new $.Shell().cwd(cwd)
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) throw new Error("BUNDLE_SHA256 is not a sha256 digest")
  const actual = createHash("sha256")
    .update(await readFile(bundle))
    .digest("hex")
  if (actual !== input.sha256) {
    throw new Error(
      `The bundle has sha256 ${actual}; the release-commit job recorded ${input.sha256}. Nothing was pushed.`,
    )
  }
  await git`git bundle verify --quiet ${bundle}`.quiet()
  const heads = (await git`git bundle list-heads ${bundle}`.text()).trim().split("\n")
  const [listed, ref] = heads[0]?.split(" ") ?? []
  if (heads.length !== 1 || ref !== `refs/tags/${tag}` || !listed) {
    throw new Error(`The bundle must hold exactly refs/tags/${tag}; it holds: ${heads.join(", ")}. Nothing was pushed.`)
  }
  await git`git -c fetch.fsckObjects=true fetch --quiet --no-tags ${bundle} ${`+refs/tags/${tag}:refs/kilo-release/bundle`}`
  // The changelog check needs the commit history of the dispatch commit (commits only, no trees or blobs).
  if ((await git`git rev-parse --is-shallow-repository`.text()).trim() === "true") {
    await git`git fetch --quiet --no-tags --filter=tree:0 --unshallow origin ${base}`
  }
  const fetched = (await git`git rev-parse refs/kilo-release/bundle`.text()).trim()
  const problems = [
    ...shape({ cwd, commit: listed, parents: [base], subject: `release: ${tag}` }),
    ...(fetched === listed ? check({ cwd, from: base, to: fetched, version }) : [`the tag does not name ${fetched}`]),
  ]
  if (problems.length > 0) throw new Error(`The release commit is refused. Nothing was pushed.\n${problems.join("\n")}`)

  // The release commit is written here; the bundle contributes its checked tree and its timestamp.
  const tree = (await git`git rev-parse ${`${fetched}^{tree}`}`.text()).trim()
  const stamp = Number((await git`git log -1 --format=%ct ${fetched}`.text()).trim())
  const earliest = Number((await git`git log -1 --format=%ct ${base}`.text()).trim())
  if (!Number.isSafeInteger(stamp) || stamp < earliest || stamp > Date.now() / 1000 + 600) {
    throw new Error(
      `The bundle commit's timestamp ${stamp} is not between the dispatch commit and now. Nothing was pushed.`,
    )
  }
  const who = {
    GIT_AUTHOR_NAME: IDENTITY.name,
    GIT_AUTHOR_EMAIL: IDENTITY.email,
    GIT_COMMITTER_NAME: IDENTITY.name,
    GIT_COMMITTER_EMAIL: IDENTITY.email,
  }
  const date = `@${stamp} +0000`
  const commit = (
    await git`git commit-tree ${tree} -p ${base} -m ${`release: ${tag}`}`
      .env({ ...process.env, ...who, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date })
      .text()
  ).trim()

  const remote = async (name: string) =>
    (await git`git ls-remote origin ${name}`.nothrow().text()).trim().split(/\s+/)[0] ?? ""

  const existing = await remote(`refs/tags/${tag}`)
  if (existing === commit) {
    console.log(`Tag ${tag} on origin already names the release commit ${commit}; nothing to push.`)
    return { commit, main: "", skipped: true }
  }
  if (existing !== "") {
    throw new Error(`Tag ${tag} on origin names ${existing}, not the release commit ${commit}. Nothing was pushed.`)
  }

  let head = ""
  let target = commit
  let merges = 0
  let retries = 0
  for (let attempt = 0; ; attempt++) {
    if (attempt === 0 || head === "") {
      head = await remote("refs/heads/main")
      if (!/^[0-9a-f]{40}$/.test(head)) throw new Error("Could not read main on origin. Nothing was pushed.")
      target = commit
      if (head !== base) {
        if ((await git`git cat-file -e ${`${head}^{commit}`}`.quiet().nothrow()).exitCode !== 0) {
          await git`git fetch --quiet --no-tags --depth=1 origin ${head}`
        }
        const merged = await git`git merge-tree --write-tree ${`--merge-base=${base}`} ${head} ${commit}`
          .quiet()
          .nothrow()
        if (merged.exitCode === 1) {
          throw new Error(
            `The release commit conflicts with main at ${head}:\n${merged.stdout.toString()}Nothing was pushed.`,
          )
        }
        if (merged.exitCode !== 0) throw new Error(`git merge-tree failed: ${merged.stderr.toString()}`)
        const result = merged.stdout.toString().split("\n")[0]?.trim() ?? ""
        target = (
          await git`git commit-tree ${result} -p ${head} -p ${commit} -m ${`Merge release ${tag} into main`}`
            .env({ ...process.env, ...who })
            .text()
        ).trim()
        const found = [
          ...shape({ cwd, commit: target, parents: [head, commit] }),
          ...check({ cwd, from: head, to: target, version, base }),
        ]
        if (found.length > 0)
          throw new Error(`The merge with main is refused. Nothing was pushed.\n${found.join("\n")}`)
        console.log(`main moved from ${base} to ${head}; merged the release commit as ${target}`)
      }
    }
    await input.before?.(attempt, { head, target, commit })
    const pushed =
      await git`git -c push.negotiate=true push --atomic --porcelain ${`--force-with-lease=refs/heads/main:${head}`} origin ${`${target}:refs/heads/main`} ${`${commit}:refs/tags/${tag}`}`
        .quiet()
        .nothrow()
    if (pushed.exitCode === 0) {
      console.log(`Pushed main ${target} and tag ${tag} (${commit})`)
      return { commit, main: target, skipped: false }
    }
    const now = { main: await remote("refs/heads/main"), tag: await remote(`refs/tags/${tag}`) }
    if (now.main === target && now.tag === commit) {
      console.log(`The push reported a failure, but main is ${target} and tag ${tag} names ${commit}: pushed.`)
      return { commit, main: target, skipped: false }
    }
    const output = `${pushed.stdout.toString()}${pushed.stderr.toString()}`
    if (now.main === head && now.tag === "" && retries < 2) {
      retries++
      console.log(`The push failed with main unchanged; pushing again (${retries}/2):\n${output}`)
      await sleep(input.wait ?? 3_000)
      continue
    }
    if (now.main !== head && now.tag === "" && merges < 2) {
      merges++
      console.log(`main moved to ${now.main} during the push; merging again (${merges}/2)`)
      head = ""
      continue
    }
    throw new Error(
      `The push of main and ${tag} failed${now.main !== head ? " and main kept moving" : ""}. Nothing was pushed.\n${output}`,
    )
  }
}

if (import.meta.main) {
  const bundle = process.argv[2]
  const { BUNDLE_SHA256, VERSION, BASE } = process.env
  if (!bundle || !BUNDLE_SHA256 || !VERSION || !BASE) {
    throw new Error("Usage: BUNDLE_SHA256=… VERSION=… BASE=… release-push.ts <release.bundle>")
  }
  const result = await push({
    cwd: process.cwd(),
    bundle: path.resolve(bundle),
    sha256: BUNDLE_SHA256,
    version: VERSION,
    base: BASE,
  })
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `commit=${result.commit}\nskipped=${result.skipped}\n`)
  }
}
