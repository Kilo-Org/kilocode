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
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".yml", ".yaml", ".toml", ".sh", ".bash", ".zsh"])
const SCOPES = [
  "sdks/vscode",
  "packages/opencode",
  "packages/extensions",
  "packages/ui",
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
  return content(file).startsWith("#!") // kilocode_change
}

// Parses the unified=0 diff for `file` against `base` and returns:
//   - added: every added line number on HEAD
//   - revert: true when the file's diff removes any kilocode_change marker.
//     In that case the changes are reverting Kilo modifications back to the
//     upstream baseline, so newly added lines (which are restoring upstream
//     content) should not require a marker. Refs that depended on a removed
//     Kilo construct (e.g. `unixSkip(` → `unix(`) often live in different
//     hunks than the marker itself, so we use file-level detection rather
//     than hunk-level to avoid false positives on legitimate reverts.
function addedLines(file: string): { added: Set<number>; revert: boolean } {
  const diff = run("git", ["diff", "--unified=0", "--diff-filter=AMRT", `${base}...HEAD`, "--", file])
  const added = new Set<number>()
  let revert = false
  const all = diff.split("\n")

  let i = 0
  while (i < all.length) {
    const header = all[i] ?? ""
    const m = header.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (!m) {
      i++
      continue
    }

    const start = Number(m[1])
    let pos = 0
    let j = i + 1
    while (j < all.length) {
      const hl = all[j] ?? ""
      if (hl.startsWith("@@") || hl.startsWith("diff ")) break
      if (hl.startsWith("+") && !hl.startsWith("+++")) {
        added.add(start + pos)
        pos++
      } else if (hl.startsWith("-") && !hl.startsWith("---") && hasMarker(hl.slice(1))) {
        revert = true
      }
      j++
    }

    i = j
  }

  return { added, revert }
}

// kilocode_change start
function content(file: string) {
  const abs = path.join(ROOT, file)
  if (existsSync(abs)) return readFileSync(abs, "utf8")

  const out = run("git", ["show", `HEAD:${file}`])
  const target = out.trim()
  if (!target.startsWith("../")) return out

  return readFileSync(path.resolve(path.dirname(abs), target), "utf8")
}
// kilocode_change end

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
  const { added, revert } = addedLines(file)
  if (added.size === 0) continue
  if (revert) continue // kilocode_change - file is reverting Kilo modifications back to upstream

  const text = content(file) // kilocode_change
  const { lines, covered } = coveredLines(text)

  for (const n of added) {
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
