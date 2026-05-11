#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Warns when pull requests change user-facing product code without adding a
 * changeset. The path filter is intentionally conservative: docs, tests, CI,
 * and repository tooling do not need release notes, while product source paths
 * should usually have one unless the change is internal.
 */

import { spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
const args = process.argv.slice(2)
const idx = args.indexOf("--base")
const base = idx === -1 ? "origin/main" : args[idx + 1]

if (!base) {
  console.error("Usage: bun run script/check-changeset.ts [--base <ref>]")
  process.exit(1)
}

const scopes = [
  "packages/kilo-gateway/package.json",
  "packages/kilo-gateway/src/",
  "packages/kilo-i18n/package.json",
  "packages/kilo-i18n/src/",
  "packages/kilo-jetbrains/backend/src/",
  "packages/kilo-jetbrains/frontend/src/",
  "packages/kilo-jetbrains/package.json",
  "packages/kilo-jetbrains/shared/src/",
  "packages/kilo-jetbrains/src/",
  "packages/kilo-telemetry/package.json",
  "packages/kilo-telemetry/src/",
  "packages/kilo-ui/package.json",
  "packages/kilo-ui/src/",
  "packages/kilo-vscode/package.json",
  "packages/kilo-vscode/src/",
  "packages/kilo-vscode/webview-ui/",
  "packages/opencode/package.json",
  "packages/opencode/src/",
  "packages/plugin/package.json",
  "packages/plugin/src/",
]

function run(cmd: string, args: string[]) {
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" })
  if (res.status === 0) return res.stdout?.trim() ?? ""

  const msg = res.stderr?.trim() || res.stdout?.trim() || "unknown error"
  console.error(`Command failed: ${cmd} ${args.join(" ")}\n${msg}`)
  process.exit(1)
}

function norm(file: string) {
  return file.replaceAll("\\", "/")
}

function changed() {
  const out = run("git", ["diff", "--name-only", "--diff-filter=ACDMRT", `${base}...HEAD`])
  return out ? out.split("\n").filter(Boolean).map(norm) : []
}

function changeset(file: string) {
  return file.startsWith(".changeset/") && file.endsWith(".md") && file !== ".changeset/README.md"
}

function escape(value: string) {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")
}

function scoped(file: string) {
  return scopes.some((scope) => (scope.endsWith("/") ? file.startsWith(scope) : file === scope))
}

function skipped(file: string) {
  const lower = file.toLowerCase()
  if (changeset(file)) return true
  if (lower.endsWith(".md")) return true
  if (lower.includes("/test/") || lower.includes("/tests/") || lower.includes("/__tests__/")) return true
  if (lower.includes("/fixture/") || lower.includes("/fixtures/")) return true
  if (lower.includes("/stories/") || lower.match(/\.(test|spec|stories)\.[^.]+$/)) return true
  return false
}

const files = changed()
const notes = files.filter(changeset)

if (notes.length > 0) {
  console.log(`check-changeset: found ${notes.length} changeset file(s).`)
  process.exit(0)
}

const triggers = files.filter((file) => scoped(file) && !skipped(file))

if (triggers.length === 0) {
  console.log("check-changeset: no release-note-worthy product files changed.")
  process.exit(0)
}

const msg = "This PR changes product files without a changeset. Add one if the change is user-facing."

if (process.env.GITHUB_ACTIONS === "true") {
  console.log(`::warning title=Missing changeset::${escape(msg)}`)
}

console.warn(msg)
console.warn("Run: bunx changeset add")
console.warn("Skip changesets for internal refactors, CI tweaks, test-only changes, or docs-only changes.")
console.warn("")
console.warn("Files that triggered this warning:")
for (const file of triggers.slice(0, 25)) console.warn(`- ${file}`)
if (triggers.length > 25) console.warn(`- ...and ${triggers.length - 25} more`)
process.exit(0)
