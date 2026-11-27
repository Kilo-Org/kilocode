#!/usr/bin/env bun
// kilocode_change - new file
/**
 * Decides the release version and creates the draft release, in the release-draft job of
 * .github/workflows/publish.yml. This is the only place the version is decided.
 *
 * The job holds the job token with contents: write and installs nothing: this script imports only
 * Bun and Node built-ins.
 *
 *   bun script/kilocode/release-draft.ts
 *
 * Environment: REQUESTED (the workflow's `version` input), BUMP and PRE_RELEASE (its `bump` and
 * `pre_release` inputs), GH_REPO, GH_TOKEN, GITHUB_RUN_ID. Writes `version`, `release` (the
 * draft's id) and `tag` to GITHUB_OUTPUT.
 *
 * decide() is a pure function of the `vx.y.z` tags on origin, every release (drafts included), the
 * marker of this run's draft and the inputs. Without a requested version the version is the `bump`
 * (default patch) of the highest plain version among those tags and release tag names, leaving out
 * this run's own draft: an orphan draft of an earlier run counts. A requested version must be
 * `x.y.z` or `x.y.z-rc.n` (`-rc.n` only for a pre-release), must not be a tag or a release yet,
 * and a requested `x.y.z` must be above the highest version. Only a re-run of this job in the same
 * workflow run reuses the draft its first attempt created (marked with the run id); any other
 * existing release of that version stops the run before any build, image or upload. Right before
 * the draft is created the tag is looked up once more, and anything but "not found" stops the run.
 * Later jobs address the release by its id (drafts have no tag yet, and two drafts can share a tag
 * name).
 */

import { $ } from "bun"
import { appendFile } from "node:fs/promises"

const VERSION = /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/
const PLAIN = /^v(\d+)\.(\d+)\.(\d+)$/

export type Release = { id: number; tag_name: string; draft: boolean; body: string | null }
export type Inputs = { requested: string; bump: string; prerelease: boolean }
type Triple = readonly [number, number, number]

const parse = (tag: string): Triple | undefined => {
  const match = PLAIN.exec(tag)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
}
const compare = (a: Triple, b: Triple) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** The highest plain `vx.y.z` among `tags`. */
export function highest(tags: string[]) {
  const versions = tags.map(parse).filter((item) => item !== undefined)
  const top = versions.sort(compare).at(-1)
  if (!top) throw new Error("No vx.y.z tag or release to bump")
  return top
}

/** The `bump` of the highest plain `vx.y.z` among `tags`. */
export function next(tags: string[], bump: string) {
  const [major, minor, patch] = highest(tags)
  if (bump === "major") return `${major + 1}.0.0`
  if (bump === "minor") return `${major}.${minor + 1}.0`
  if (bump === "patch" || bump === "") return `${major}.${minor}.${patch + 1}`
  throw new Error(`Unknown bump ${JSON.stringify(bump)}`)
}

/**
 * The version, and this run's own draft for it when an earlier attempt created one. Throws with
 * the reason when nothing may be created.
 */
export function decide(input: { tags: string[]; releases: Release[]; marker: string } & Inputs) {
  const own = input.releases.filter((item) => item.draft && item.body === input.marker)
  if (own.length > 1) throw new Error(`This run created ${own.length} drafts: ${own.map((item) => item.id).join(", ")}`)
  const others = input.releases.filter((item) => !own.includes(item))
  const names = [...input.tags, ...others.map((item) => item.tag_name)]
  const version = (() => {
    const requested = input.requested
    if (requested === "") return next(names, input.bump)
    if (!VERSION.test(requested))
      throw new Error(`The requested version ${JSON.stringify(requested)} is not x.y.z or x.y.z-rc.n`)
    if (requested.includes("-rc.") && !input.prerelease) {
      throw new Error(`The requested version ${requested} is a release candidate, but pre_release is false`)
    }
    const plain = parse(`v${requested}`)
    if (plain && compare(plain, highest(names)) <= 0) {
      throw new Error(`The requested version ${requested} is not above the highest version ${highest(names).join(".")}`)
    }
    return requested
  })()
  const tag = `v${version}`
  if (input.tags.includes(tag))
    throw new Error(`Tag ${tag} already exists: it was released already. Nothing was created.`)
  const existing = others.filter((item) => item.tag_name === tag)
  if (existing.length) {
    const ids = existing.map((item) => `${item.id}${item.draft ? " (draft of another run)" : ""}`).join(", ")
    throw new Error(`A release for ${tag} already exists: ${ids}. Nothing was created.`)
  }
  const [mine] = own
  if (mine && mine.tag_name !== tag) {
    throw new Error(
      `This run's draft ${mine.id} is for ${mine.tag_name}, but the version is now ${version}. Nothing was created.`,
    )
  }
  return { version, tag, reuse: mine }
}

/** A lookup of the tag ref: exit 0 means it exists, HTTP 404 that it does not; anything else stops. */
export function absent(tag: string, result: { exitCode: number; stderr: string }) {
  if (result.exitCode === 0) throw new Error(`Tag ${tag} already exists: it was released already. Nothing was created.`)
  if (!/HTTP 404/.test(result.stderr)) throw new Error(`Could not check tag ${tag}: ${result.stderr.trim()}`)
}

/** What run() reads and writes, substituted in tests. */
export type IO = {
  tags: () => Promise<string[]>
  releases: () => Promise<Release[]>
  ref: (tag: string) => Promise<{ exitCode: number; stderr: string }>
  create: (input: { tag: string; marker: string; prerelease: boolean }) => Promise<{ id: number; tag_name: string }>
}

/** Decides the version and creates (or reuses) the draft. */
export async function run(io: IO, input: Inputs & { marker: string }) {
  const decided = decide({ ...input, tags: await io.tags(), releases: await io.releases() })
  if (decided.reuse) {
    console.log(
      `Reusing draft release ${decided.reuse.id} for ${decided.tag}, created by an earlier attempt of this run`,
    )
    return { version: decided.version, release: String(decided.reuse.id), tag: decided.tag }
  }
  absent(decided.tag, await io.ref(decided.tag))
  const created = await io.create({ tag: decided.tag, marker: input.marker, prerelease: input.prerelease })
  return { version: decided.version, release: String(created.id), tag: created.tag_name }
}

if (import.meta.main) {
  const repo = process.env.GH_REPO
  if (!repo) throw new Error("GH_REPO is required")
  const io: IO = {
    tags: async () =>
      (await $`git ls-remote --tags --refs origin ${"refs/tags/v*"}`.text())
        .split("\n")
        .map((line) => line.split("\t")[1]?.replace(/^refs\/tags\//, "") ?? "")
        .filter(Boolean),
    releases: async () => {
      // Interpolated, so that the shell does not read `[]` and `?` as globs.
      const [jq, list] = [".[]", `repos/${repo}/releases?per_page=100`]
      return (await $`gh api --paginate --jq ${jq} ${list}`.text())
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line))
    },
    ref: async (tag) => {
      const result = await $`gh api repos/${repo}/git/ref/tags/${tag}`.quiet().nothrow()
      return { exitCode: result.exitCode, stderr: result.stderr.toString() }
    },
    create: async ({ tag, marker, prerelease }) => {
      const fields = ["-f", `tag_name=${tag}`, "-f", `name=${tag}`, "-f", `body=${marker}`, "-F", "draft=true"]
      if (prerelease) fields.push("-F", "prerelease=true")
      return $`gh api --method POST repos/${repo}/releases ${fields}`.json()
    },
  }
  const created = await run(io, {
    requested: process.env.REQUESTED ?? "",
    bump: (process.env.BUMP ?? "").toLowerCase(),
    prerelease: process.env.PRE_RELEASE === "true",
    marker: `Draft for publish run ${process.env.GITHUB_RUN_ID ?? "local"}`,
  })
  console.log(`Draft release ${created.release} for ${created.tag}`)
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `version=${created.version}\nrelease=${created.release}\ntag=${created.tag}\n`,
    )
  }
}
