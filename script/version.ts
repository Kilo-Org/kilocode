#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"

const output = [`version=${Script.version}`]

// kilocode_change - publish.yml no longer runs this script: its release-draft job
// (script/kilocode/release-draft.ts) decides the version without installing packages and creates
// the draft release.

output.push(`repo=${process.env.GH_REPO}`)

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
