#!/usr/bin/env bun

/**
 * Verifies that every Kilo-specific change in shared upstream-owned source files
 * is annotated with a kilocode_change marker.
 *
 * Usage:
 *   bun run script/check-opencode-annotations.ts                  # diff against origin/main
 *   bun run script/check-opencode-annotations.ts --base <ref>     # diff against <ref>
 *
 * A line is "covered" if it:
 *   - contains a kilocode_change marker comment           (inline annotation)
 *   - falls inside a kilocode_change start/end block      (block annotation)
 *   - is in a file whose first non-shebang non-empty line is (whole-file annotation)
 *     // kilocode_change - new file
 *   - is empty / whitespace-only                          (skipped)
 *   - is itself a marker line                             (auto-covered)
 *
 * JS (//), JSX ({/ * ... * /}), YAML (#), TOML (#), and shell (#) comment styles are recognized.
 * Extensionless files with shebangs are treated as source files.
 *
 * Exempt paths (no markers needed — entirely Kilo-specific):
 *   - packages/opencode/src/kilocode/**
 *   - packages/opencode/test/kilocode/**
 *   - Any path containing "kilocode" in directory or filename
 *   - Any path with a directory starting with "kilo-" (e.g. kilo-sessions/)
 *   - script/upstream/**
 *   - Kilo-specific annotation checker support files
 */

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".yml", ".yaml", ".toml", ".sh", ".bash", ".zsh"])
const SCOPES = [
  "sdks/vscode",
  "packages/opencode",
  "packages/extensions",
  "packages/ui",
  "packages/app",
  "packages/desktop",
  "packages/desktop-electron",
  "packages/shared",
  "packages/script",
  "packages/storybook",
  "script",
  ".github",
  "github",
]
const EXEMPT_SCOPES = [
  "script/upstream",
  "script/check-opencode-annotations.ts",
  "packages/script/tests/check-opencode-annotations.test.ts",
  ".github/workflows/check-opencode-annotations.yml",
]

const args = process.argv.slice(2)
const baseIdx = args.indexOf("--base")
const base = baseIdx !== -1 ? args[baseIdx + 1] : "origin/main"

function run(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" })
  if (result.status !== 0) {
    const msg = result.stderr?.trim() || result.stdout?.trim() || "unknown error"
    console.error(`Command failed: ${cmd} ${args.join(" ")}\n${msg}`)
    process.exit(1)
  }
  return result.stdout?.trim() ?? ""
}

function changedFiles() {
  const out = run("git", ["diff", "--name-only", "--diff-filter=AMRT", `${base}...HEAD`, "--", ...SCOPES])
  return out ? out.split("\n").filter(Boolean) : []
}

function isUpstreamMerge() {
  const out = run("git", ["log", "--format=%P%x09%s", `${base}..HEAD`])
  return out.split("\n").some((line) => {
    const [parents = "", subject = ""] = line.split("\t")
    if (!parents.includes(" ")) return false
    const s = subject.toLowerCase()
    return s.startsWith("merge: upstream ") || s.startsWith("resolve merge conflict")
  })
}

function isExempt(file: string) {
  const norm = file.replaceAll("\\", "/").toLowerCase()
  if (norm.split("/").some((part) => part.includes("kilocode") || part.startsWith("kilo-"))) return true
  return EXEMPT_SCOPES.some((scope) => norm === scope || norm.startsWith(`${scope}/`))
}

function isChecked(file: string) {
  const norm = file.replaceAll("\\", "/")
  return SCOPES.some((scope) => norm === scope || norm.startsWith(`${scope}/`))
}

function isSource(file: string) {
  const ext = path.extname(file)
  if (SOURCE_EXTS.has(ext)) return true
  if (ext) return false
  return readFileSync(path.join(ROOT, file), "utf8").startsWith("#!")
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

// Matches the start of a kilocode_change marker in JS, JSX, YAML, TOML, and shell comments.
const MARKER_PREFIX = /(?:\/\/|\{?\s*\/\*|#)\s*kilocode_change\b/

function hasMarker(line: string) {
  return MARKER_PREFIX.test(line)
}

function coveredLines(text: string): { lines: string[]; covered: Set<number> } {
  const lines = text.split(/\r?\n/)
  const covered = new Set<number>()

  // Whole-file annotation: first non-shebang non-empty line is a kilocode_change - new file marker.
  const first = lines.find((x) => x.trim() !== "" && !x.startsWith("#!"))
  if (first?.match(/(?:\/\/|\{?\s*\/\*|#)\s*kilocode_change\s*-\s*new\s*file\b/)) {
    for (let i = 1; i <= lines.length; i++) covered.add(i)
    return { lines, covered }
  }

  let block = false
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1
    const line = lines[i] ?? ""

    if (line.match(/(?:\/\/|\{?\s*\/\*|#)\s*kilocode_change\s+start\b/)) {
      block = true
      covered.add(n)
      continue
    }

    if (line.match(/(?:\/\/|\{?\s*\/\*|#)\s*kilocode_change\s+end\b/)) {
      covered.add(n)
      block = false
      continue
    }

    if (block) {
      covered.add(n)
      continue
    }

    if (hasMarker(line)) covered.add(n)
  }

  return { lines, covered }
}

// --- main ---

if (isUpstreamMerge()) {
  console.log("Skipping shared upstream annotation check — upstream merge detected.")
  process.exit(0)
}

const files = changedFiles().filter((f) => isChecked(f) && !isExempt(f) && isSource(f))

if (files.length === 0) {
  console.log("No shared upstream source files changed — nothing to check.")
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
    if (hasMarker(trim)) continue
    if (!covered.has(n)) violations.push(`  ${file}:${n}: ${trim}`)
  }
}

if (violations.length === 0) {
  console.log("All shared upstream changes are annotated with kilocode_change markers.")
  process.exit(0)
}

console.error(
  [
    "Unannotated Kilo changes found in shared upstream files:",
    "",
    ...violations,
    "",
    "Every Kilo-specific change in shared upstream source files must be annotated.",
    "",
    "Checked paths:",
    ...SCOPES.map((scope) => `  - ${scope}/**`),
    "",
    "Inline (single line):",
    "  const url = Flag.KILO_MODELS_URL || 'https://models.dev' // kilocode_change",
    "",
    "Block (multiple lines):",
    "  // kilocode_change start",
    "  ...",
    "  // kilocode_change end",
    "",
    "JSX/TSX (inside JSX templates):",
    "  {/* kilocode_change */}",
    "  {/* kilocode_change start */}",
    "  ...",
    "  {/* kilocode_change end */}",
    "",
    "YAML/TOML/shell:",
    "  # kilocode_change",
    "  # kilocode_change start",
    "  ...",
    "  # kilocode_change end",
    "",
    "New file:",
    "  // kilocode_change - new file",
    "",
    "Exempt paths (no markers needed):",
    "  - packages/opencode/src/kilocode/**",
    "  - packages/opencode/test/kilocode/**",
    "  - Any path containing 'kilocode' in the directory or filename",
    "  - Any directory starting with 'kilo-' (e.g. kilo-sessions/)",
    "  - script/upstream/**",
    "  - Kilo-specific annotation checker support files",
    "",
    "See AGENTS.md for details.",
  ].join("\n"),
)

process.exit(1)
