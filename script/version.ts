#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"

const output = [`version=${Script.version}`]

// kilocode_change start - create the draft release and record the id the create call returned;
// later jobs address the release by that id (drafts have no tag yet, and two drafts can share a
// tag name). Changelog generation and release notes are handled by publish.ts on the same runner
// that commits. A version that already has a tag or a release stops here, before any build,
// image or upload; only a re-run of this job in the same workflow run reuses the draft its
// first attempt created (marked with the run id).
async function draft(prerelease: boolean) {
  const tag = `v${Script.version}`
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
  const own = existing.length === 1 && existing[0].draft && existing[0].body === marker ? existing[0] : undefined
  if (own) {
    console.log(`Reusing draft release ${own.id} for ${tag}, created by an earlier attempt of this run`)
    output.push(`release=${own.id}`)
    output.push(`tag=${own.tag_name}`)
    return
  }
  if (existing.length) {
    const ids = existing.map((item) => `${item.id}${item.draft ? " (draft)" : ""}`).join(", ")
    throw new Error(`A release for ${tag} already exists: ${ids}. Nothing was created.`)
  }
  const fields = ["-f", `tag_name=${tag}`, "-f", `name=${tag}`, "-f", `body=${marker}`, "-F", "draft=true"]
  if (prerelease) fields.push("-F", "prerelease=true")
  const release = await $`gh api --method POST repos/${repo}/releases ${fields}`.json()
  output.push(`release=${release.id}`)
  output.push(`tag=${release.tag_name}`)
}

if (!Script.preview) {
  await draft(false)
  // handle both beta and rc preview channels
} else if (Script.channel === "beta" || Script.channel === "rc") {
  await draft(true)
}
// kilocode_change end

output.push(`repo=${process.env.GH_REPO}`)

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
