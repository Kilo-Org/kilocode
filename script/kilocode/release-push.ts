#!/usr/bin/env bun
// kilocode_change - new file
/**
 * Pushes the release commit and its tag in the release-push job of .github/workflows/publish.yml.
 *
 * The job runs in the release-keys environment with a Kilo Maintainer app token (served by the git
 * credential helper of setup-git-committer) and installs nothing: this script imports only Node and
 * Bun built-ins and this repository's release-check.ts and release-commit.ts.
 *
 *   bun script/kilocode/release-push.ts <release.bundle>
 *
 * Environment: BUNDLE_SHA256 (the release-commit job's output), VERSION, BASE (the dispatch
 * commit, github.sha), GH_REPO and GH_TOKEN (read-only lookups of release-commit.ts).
 *
 * 1. The bundle must have that sha256, hold exactly the tag `v<version>`, and the tag must name a
 *    commit (no tag object) whose only parent is BASE and whose subject is `release: v<version>`.
 * 2. release-check.ts compares the full trees of BASE and the commit.
 * 3. A re-run that finds the tag already on main (pushed() of release-commit.ts) checks that the tag
 *    names this commit and pushes nothing.
 * 4. When main is still BASE, main fast-forwards to the commit. Otherwise git merges main and the
 *    commit (merge-tree and commit-tree only; a conflict refuses the run) and release-check.ts
 *    compares main with the merge, so only the release lines and paths change on main. The tag stays
 *    on the release commit, the exact source the build jobs built.
 * 5. main and the tag are pushed with one atomic push whose lease pins main to the merged head. If
 *    main moved again, the merge is made again, at most twice.
 */

import { $ } from "bun"
import { createHash } from "node:crypto"
import { appendFile, readFile } from "node:fs/promises"
import path from "node:path"
import { check, shape } from "./release-check"
import { pushed } from "./release-commit"

export type Input = {
  /** The repository whose `origin` receives the push. */
  cwd: string
  bundle: string
  sha256: string
  version: string
  base: string
  /** How often main may be merged again after it moved during the push (default 2). */
  merges?: number
  /** Called before each push attempt; tests move main here. */
  before?: (attempt: number) => Promise<void>
}

export async function push(input: Input) {
  // release-commit.ts runs its git commands in the process working directory: the repository.
  const previous = process.cwd()
  process.chdir(input.cwd)
  try {
    return await run(input)
  } finally {
    process.chdir(previous)
  }
}

async function run(input: Input) {
  const { cwd, bundle, version, base } = input
  const tag = `v${version}`
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
  await git`git fetch --quiet --no-tags ${bundle} ${`+refs/tags/${tag}:refs/kilo-release/commit`}`
  const commit = (await git`git rev-parse refs/kilo-release/commit`.text()).trim()
  const problems = [
    ...shape({ cwd, commit: listed, parents: [base], subject: `release: ${tag}` }),
    ...(commit === listed ? check({ cwd, from: base, to: commit, version }) : [`the tag does not name ${commit}`]),
  ]
  if (problems.length > 0) throw new Error(`The release commit is refused. Nothing was pushed.\n${problems.join("\n")}`)

  const remote = async (name: string) =>
    (await git`git ls-remote --exit-code origin ${name}`.nothrow().text()).trim().split(/\s+/)[0] ?? ""

  if (await pushed(version)) {
    const found = await remote(`refs/tags/${tag}`)
    if (found !== commit) {
      throw new Error(`Tag ${tag} on origin names ${found}, not the release commit ${commit}. Nothing was pushed.`)
    }
    console.log(`Tag ${tag} is already on main at the release commit ${commit}; nothing to push.`)
    return { commit, main: "", skipped: true }
  }

  const merges = input.merges ?? 2
  for (let attempt = 0; ; attempt++) {
    const head = await remote("refs/heads/main")
    if (!/^[0-9a-f]{40}$/.test(head)) throw new Error("Could not read main on origin. Nothing was pushed.")
    if ((await git`git cat-file -e ${`${head}^{commit}`}`.quiet().nothrow()).exitCode !== 0) {
      await git`git fetch --quiet --no-tags --depth=1 origin ${head}`
    }
    let target = commit
    if (head !== base) {
      const merged = await git`git merge-tree --write-tree ${`--merge-base=${base}`} ${head} ${commit}`
        .quiet()
        .nothrow()
      if (merged.exitCode === 1) {
        throw new Error(
          `The release commit conflicts with main at ${head}:\n${merged.stdout.toString()}Nothing was pushed.`,
        )
      }
      if (merged.exitCode !== 0) throw new Error(`git merge-tree failed: ${merged.stderr.toString()}`)
      const tree = merged.stdout.toString().split("\n")[0]?.trim() ?? ""
      target = (
        await git`git commit-tree ${tree} -p ${head} -p ${commit} -m ${`Merge release ${tag} into main`}`.text()
      ).trim()
      const found = [
        ...shape({ cwd, commit: target, parents: [head, commit] }),
        ...check({ cwd, from: head, to: target, version }),
      ]
      if (found.length > 0) throw new Error(`The merge with main is refused. Nothing was pushed.\n${found.join("\n")}`)
      console.log(`main moved from ${base} to ${head}; merged the release commit as ${target}`)
    }
    await input.before?.(attempt)
    const result =
      await git`git push --atomic --porcelain ${`--force-with-lease=refs/heads/main:${head}`} origin ${`${target}:refs/heads/main`} ${`${commit}:refs/tags/${tag}`}`
        .quiet()
        .nothrow()
    if (result.exitCode === 0) {
      console.log(`Pushed main ${target} and tag ${tag} (${commit})`)
      return { commit, main: target, skipped: false }
    }
    const now = await remote("refs/heads/main")
    if (now !== head && attempt < merges) {
      console.log(`main moved to ${now} during the push; merging again (${attempt + 1}/${merges})`)
      continue
    }
    throw new Error(
      `The push of main and ${tag} failed${now !== head ? " and main kept moving" : ""}. Nothing was pushed.\n${result.stdout.toString()}${result.stderr.toString()}`,
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
