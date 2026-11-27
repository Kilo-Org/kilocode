#!/usr/bin/env bun
// kilocode_change - new file
/**
 * Checks the version the `version` job of .github/workflows/publish.yml proposed and creates the
 * draft release, in the release-draft job.
 *
 * `version` installs packages, so it holds only read access and its output is a proposal. This job
 * holds the job token with contents: write and installs nothing: this script imports only Bun and
 * Node built-ins.
 *
 *   bun script/kilocode/release-draft.ts
 *
 * Environment: PROPOSED (the `version` job's output), REQUESTED (the workflow's `version` input),
 * BUMP and PRE_RELEASE (its `bump` and `pre_release` inputs), GH_REPO, GH_TOKEN, GITHUB_RUN_ID.
 * Writes `version`, `release` (the draft's id) and `tag` to GITHUB_OUTPUT.
 *
 * The version must be `x.y.z` or `x.y.z-rc.n` (an `-rc.n` version only for a pre-release). With a
 * requested version it must be that version; otherwise it must be the `bump` (default patch) of the
 * highest `vx.y.z` tag on origin. A version that already has a tag or a release stops here, before
 * any build, image or upload; only a re-run of this job in the same workflow run reuses the draft
 * its first attempt created (marked with the run id). Later jobs address the release by its id
 * (drafts have no tag yet, and two drafts can share a tag name).
 */

import { $ } from "bun"
import { appendFile } from "node:fs/promises"

const VERSION = /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/
const PLAIN = /^v(\d+)\.(\d+)\.(\d+)$/

/** The `bump` of the highest plain `vx.y.z` tag. */
export function next(tags: string[], bump: string) {
  const versions = tags
    .map((tag) => PLAIN.exec(tag))
    .filter((match) => match !== null)
    .map((match) => [Number(match[1]), Number(match[2]), Number(match[3])] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
  const highest = versions.at(-1)
  if (!highest) throw new Error("No vx.y.z tag on origin to bump")
  const [major, minor, patch] = highest
  if (bump === "major") return `${major + 1}.0.0`
  if (bump === "minor") return `${major}.${minor + 1}.0`
  if (bump === "patch" || bump === "") return `${major}.${minor}.${patch + 1}`
  throw new Error(`Unknown bump ${JSON.stringify(bump)}`)
}

/** The checked version, or an error naming why the proposal is refused. */
export function decide(input: {
  proposed: string
  requested: string
  bump: string
  prerelease: boolean
  tags: string[]
}) {
  const { proposed, requested } = input
  if (!VERSION.test(proposed))
    throw new Error(`The proposed version ${JSON.stringify(proposed)} is not x.y.z or x.y.z-rc.n`)
  if (proposed.includes("-rc.") && !input.prerelease) {
    throw new Error(`The proposed version ${proposed} is a release candidate, but pre_release is false`)
  }
  if (requested !== "") {
    if (proposed !== requested)
      throw new Error(`The proposed version ${proposed} is not the requested version ${JSON.stringify(requested)}`)
    return proposed
  }
  const expected = next(input.tags, input.bump)
  if (proposed !== expected) {
    throw new Error(
      `The proposed version ${proposed} is not the ${input.bump || "patch"} bump of the highest tag (${expected})`,
    )
  }
  return proposed
}

/** Creates the draft release for `version`, or reuses the one an earlier attempt of this run created. */
async function draft(version: string, prerelease: boolean) {
  const tag = `v${version}`
  const repo = process.env.GH_REPO
  const marker = `Draft for publish run ${process.env.GITHUB_RUN_ID ?? "local"}`
  const ref = await $`gh api repos/${repo}/git/ref/tags/${tag}`.quiet().nothrow()
  if (ref.exitCode === 0) throw new Error(`Tag ${tag} already exists: it was released already. Nothing was created.`)
  if (!/HTTP 404/.test(ref.stderr.toString())) throw new Error(`Could not check tag ${tag}: ${ref.stderr.toString()}`)
  // Interpolated, so that the shell does not read `[]` and `?` as globs.
  const [jq, list] = [".[]", `repos/${repo}/releases?per_page=100`]
  const releases: { id: number; tag_name: string; draft: boolean; body: string | null }[] = (
    await $`gh api --paginate --jq ${jq} ${list}`.text()
  )
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line))
  const existing = releases.filter((item) => item.tag_name === tag)
  const [only] = existing
  if (existing.length === 1 && only?.draft && only.body === marker) {
    console.log(`Reusing draft release ${only.id} for ${tag}, created by an earlier attempt of this run`)
    return { release: String(only.id), tag: only.tag_name }
  }
  if (existing.length) {
    const ids = existing.map((item) => `${item.id}${item.draft ? " (draft)" : ""}`).join(", ")
    throw new Error(`A release for ${tag} already exists: ${ids}. Nothing was created.`)
  }
  const fields = ["-f", `tag_name=${tag}`, "-f", `name=${tag}`, "-f", `body=${marker}`, "-F", "draft=true"]
  if (prerelease) fields.push("-F", "prerelease=true")
  const created: { id: number; tag_name: string } =
    await $`gh api --method POST repos/${repo}/releases ${fields}`.json()
  return { release: String(created.id), tag: created.tag_name }
}

if (import.meta.main) {
  const prerelease = process.env.PRE_RELEASE === "true"
  const tags = (await $`git ls-remote --tags --refs origin ${"refs/tags/v*"}`.text())
    .split("\n")
    .map((line) => line.split("\t")[1]?.replace(/^refs\/tags\//, "") ?? "")
    .filter(Boolean)
  const version = decide({
    proposed: process.env.PROPOSED ?? "",
    requested: process.env.REQUESTED ?? "",
    bump: (process.env.BUMP ?? "").toLowerCase(),
    prerelease,
    tags,
  })
  const created = await draft(version, prerelease)
  console.log(`Draft release ${created.release} for ${created.tag}`)
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\nrelease=${created.release}\ntag=${created.tag}\n`)
  }
}
