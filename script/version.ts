#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"

const output = [`version=${Script.version}`]

if (!Script.preview) {
  // kilocode_change start - use changesets for changelog generation
  // Run changeset version to consume .changeset/*.md files into CHANGELOG.md.
  // This also bumps package.json versions, but publish.ts overwrites them with
  // Script.version later, so the changeset-computed versions are irrelevant.
  // If no changesets exist yet, changeset version exits 0 but writes nothing.
  const result = await $`bunx changeset version`.nothrow()
  if (result.exitCode !== 0) {
    console.warn("changeset version failed (exit " + result.exitCode + "), continuing with fallback notes")
  }

  // Extract the latest version section from the kilo-code extension changelog.
  // Changesets writes to packages/kilo-vscode/CHANGELOG.md (not root) because
  // the changeset targets the "kilo-code" package. This is also the file the
  // VS Code Marketplace reads at publish time.
  const changelog = await Bun.file(`${process.cwd()}/packages/kilo-vscode/CHANGELOG.md`)
    .text()
    .catch(() => "")
  const body = extractLatestSection(changelog) || "No notable changes"

  const dir = process.env.RUNNER_TEMP ?? "/tmp"
  const notesFile = `${dir}/opencode-release-notes.txt`
  await Bun.write(notesFile, body)
  // kilocode_change end
  await $`gh release create v${Script.version} -d --title "v${Script.version}" --notes-file ${notesFile}`
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

// kilocode_change start - extract latest changelog section for release notes
function extractLatestSection(changelog: string): string {
  if (!changelog) return ""
  const lines = changelog.split("\n")
  // Find first ## heading (version section)
  const start = lines.findIndex((line) => /^## /.test(line))
  if (start < 0) return ""
  // Find the next ## heading after the first one
  const end = lines.findIndex((line, i) => i > start && /^## /.test(line))
  const section = lines.slice(start + 1, end < 0 ? undefined : end)
  return section.join("\n").trim()
}
// kilocode_change end

process.exit(0)
