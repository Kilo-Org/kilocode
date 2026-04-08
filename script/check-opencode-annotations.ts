#!/usr/bin/env bun

/**
 * Verifies that every Kilo-specific change in shared packages/opencode/ files
 * is annotated with a kilocode_change marker.
 *
 * Usage:
 *   bun run script/check-opencode-annotations.ts                  # diff against origin/main
 *   bun run script/check-opencode-annotations.ts --base <ref>     # diff against <ref>
 *
 * A line is "covered" if it:
 *   - contains // kilocode_change                        (inline annotation)
 *   - falls inside a // kilocode_change start/end block  (block annotation)
 *   - is in a file whose first non-empty line is         (whole-file annotation)
 *     // kilocode_change - new file
 *   - is empty / whitespace-only                         (skipped)
 *   - is itself a marker line                            (auto-covered)
 *
 * Exempt paths (no markers needed — entirely Kilo-specific):
 *   - packages/opencode/src/kilocode/**
 *   - packages/opencode/test/kilocode/**
 *   - Any path containing "kilocode" in directory or filename
 */

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx"])

const args = process.argv.slice(2)
const baseIdx = args.indexOf("--base")
const base = baseIdx !== -1 ? args[baseIdx + 1] : "origin/main"

function run(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" })
  return result.stdout?.trim() ?? ""
}

function changedFiles() {
  const out = run("git", ["diff", "--name-only", "--diff-filter=AMRT", `${base}...HEAD`, "--", "packages/opencode"])
  return out ? out.split("\n").filter(Boolean) : []
}

function isExempt(file: string) {
  const norm = file.replaceAll("\\", "/").toLowerCase()
  return norm.split("/").some((part) => part.includes("kilocode"))
}

function isSource(file: string) {
  return SOURCE_EXTS.has(path.extname(file))
}

function addedLines(file: string): Set<number> {
  const diff = run("git", ["diff", "--unified=0", "--diff-filter=AMRT", `${base}...HEAD`, "--", file])
  const out = new Set<number>()
  for (const line of diff.split("\n")) {
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (!m) continue
    const start = Number(m[1])
    const count = m[2] !== undefined ? Number(m[2]) : 1
    for (let i = 0; i < count; i++) out.add(start + i)
  }
  return out
}

function coveredLines(text: string): { lines: string[]; covered: Set<number> } {
  const lines = text.split(/\r?\n/)
  const covered = new Set<number>()

  // Whole-file annotation: first non-empty line is "// kilocode_change - new file"
  const first = lines.find((x) => x.trim() !== "")
  if (first?.match(/\/\/\s*kilocode_change\s*-\s*new\s*file\b/)) {
    for (let i = 1; i <= lines.length; i++) covered.add(i)
    return { lines, covered }
  }

  let block = false
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1
    const line = lines[i] ?? ""

    if (line.match(/\/\/\s*kilocode_change\s+start\b/)) {
      block = true
      covered.add(n)
      continue
    }

    if (line.match(/\/\/\s*kilocode_change\s+end\b/)) {
      covered.add(n)
      block = false
      continue
    }

    if (block) {
      covered.add(n)
      continue
    }

    if (line.match(/\/\/\s*kilocode_change\b/)) covered.add(n)
  }

  return { lines, covered }
}

// --- main ---

const files = changedFiles().filter((f) => !isExempt(f) && isSource(f))

if (files.length === 0) {
  console.log("No shared opencode source files changed — nothing to check.")
  process.exit(0)
}

const violations: string[] = []

for (const file of files) {
  const nums = addedLines(file)
  if (nums.size === 0) continue

  const abs = path.join(ROOT, file)
  const text = readFileSync(abs, "utf8")
  const { lines, covered } = coveredLines(text)

  for (const n of nums) {
    const line = lines[n - 1] ?? ""
    const trim = line.trim()
    if (!trim) continue
    if (trim.match(/\/\/\s*kilocode_change\b/)) continue
    if (!covered.has(n)) violations.push(`  ${file}:${n}: ${trim}`)
  }
}

if (violations.length === 0) {
  console.log("All shared opencode changes are annotated with kilocode_change markers.")
  process.exit(0)
}

console.error(
  [
    "Unannotated Kilo changes found in shared opencode files:",
    "",
    ...violations,
    "",
    "Every Kilo-specific change in packages/opencode/ must be annotated.",
    "",
    "Inline (single line):",
    "  const url = Flag.KILO_MODELS_URL || 'https://models.dev' // kilocode_change",
    "",
    "Block (multiple lines):",
    "  // kilocode_change start",
    "  ...",
    "  // kilocode_change end",
    "",
    "New file:",
    "  // kilocode_change - new file",
    "",
    "Exempt paths (no markers needed):",
    "  - packages/opencode/src/kilocode/**",
    "  - packages/opencode/test/kilocode/**",
    "  - Any path containing 'kilocode' in the directory or filename",
    "",
    "See AGENTS.md for details.",
  ].join("\n"),
)

process.exit(1)
