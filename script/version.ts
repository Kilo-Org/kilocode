#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"

const output = [`version=${Script.version}`]

if (!Script.preview) {
  // kilocode_change start - create draft release; changelog generation and
  // release notes are handled by publish.ts on the same runner that commits.
  await $`gh release create v${Script.version} -d --title "v${Script.version}" --notes ""`
  // kilocode_change end
  const release = await $`gh release view v${Script.version} --json tagName,databaseId`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
  // kilocode_change start - handle both beta and rc preview channels
} else if (Script.channel === "beta" || Script.channel === "rc") {
  await $`gh release create v${Script.version} -d --prerelease --title "v${Script.version}" --repo ${process.env.GH_REPO}`
  const release =
    await $`gh release view v${Script.version} --json tagName,databaseId --repo ${process.env.GH_REPO}`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
  // kilocode_change end
}

output.push(`repo=${process.env.GH_REPO}`)

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
