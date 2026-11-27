#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"

const output = [`version=${Script.version}`]

// kilocode_change - this job installs packages, so it only proposes the version. The install-free
// release-draft job (script/kilocode/release-draft.ts) checks it and creates the draft release.

output.push(`repo=${process.env.GH_REPO}`)

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
