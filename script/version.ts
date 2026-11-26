#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"

const output = [`version=${Script.version}`]

// kilocode_change start - create the draft release and record the id the create call returned;
// later jobs address the release by that id (drafts have no tag yet, and two drafts can share a
// tag name). Changelog generation and release notes are handled by publish.ts on the same runner
// that commits.
async function draft(prerelease: boolean) {
  const tag = `v${Script.version}`
  const fields = ["-f", `tag_name=${tag}`, "-f", `name=${tag}`, "-f", "body=", "-F", "draft=true"]
  if (prerelease) fields.push("-F", "prerelease=true")
  const release = await $`gh api --method POST repos/${process.env.GH_REPO}/releases ${fields}`.json()
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
