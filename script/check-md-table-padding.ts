#!/usr/bin/env bun

/**
 * Enforces the "no padded markdown tables" rule from AGENTS.md.
 *
 * Prettier pads markdown table cells for column alignment. Any content change
 * then re-pads every row, which pollutes diffs on untouched lines. Markdown is
 * in .prettierignore, but hand-written / upstream-synced padded tables still
 * sneak in — this check catches them.
 *
 * Usage:
 *   bun run script/check-md-table-padding.ts               # check all tracked *.md
 *   bun run script/check-md-table-padding.ts path/to/file.md [more.md ...]
 *   bun run script/check-md-table-padding.ts --fix [paths…] # rewrite in place
 *
 * What counts as a failure:
 *   - Separator row cells are anything other than `---`, `:---`, `---:`,
 *     `:---:` (after trimming a single optional leading/trailing space).
 *   - Content row cells have more than one space of padding between the
 *     content and the enclosing pipes.
 *
 * Enforcement scope (Kilo-owned paths only, to avoid upstream-sync churn):
 *   - Any top-level markdown file (TESTING.md, AGENTS.md, README.md, …)
 *   - Any path segment containing "kilocode" or starting with "kilo-"
 *   - Everything else under packages/ is treated as upstream and skipped.
 *   - .changeset/** and CHANGELOG.md are skipped (auto-generated).
 */

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")

const ok = new Set(["---", ":---", "---:", ":---:"])

function tracked() {
  const r = spawnSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" })
  if (r.status !== 0) {
    console.error(r.stderr?.trim() || "git ls-files failed")
    process.exit(1)
  }
  return r.stdout.split("\n").filter(Boolean)
}

function skip(file: string) {
  const norm = file.replaceAll("\\", "/").toLowerCase()
  if (norm.startsWith(".changeset/")) return true
  // Glossary tables are maintained as aligned prose tables for translator
  // readability; the churn cost is low since they're rarely edited.
  if (norm.startsWith(".opencode/glossary/")) return true
  if (norm === "changelog.md" || norm.endsWith("/changelog.md")) return true
  if (norm.includes("node_modules/")) return true
  const parts = norm.split("/")
  if (parts.some((p) => p.includes("kilocode") || p.startsWith("kilo-"))) return false
  if (parts.length === 1) return false
  if (parts[0] === "packages") return true
  return false
}

type Issue = { file: string; line: number; kind: "separator" | "content"; detail: string }

function split(row: string) {
  // Split on unescaped pipes, drop the empty leading/trailing cells that come
  // from rows starting and ending with a pipe.
  const cells: string[] = []
  let buf = ""
  for (let i = 0; i < row.length; i++) {
    const c = row[i]
    if (c === "\\" && row[i + 1] === "|") {
      buf += "\\|"
      i++
      continue
    }
    if (c === "|") {
      cells.push(buf)
      buf = ""
      continue
    }
    buf += c
  }
  cells.push(buf)
  if (cells.length >= 2 && cells[0].trim() === "") cells.shift()
  if (cells.length >= 1 && cells[cells.length - 1].trim() === "") cells.pop()
  return cells
}

function isSep(row: string) {
  // A separator row contains only pipes, dashes, colons, and spaces, and has
  // at least one dash.
  if (!/\|/.test(row)) return false
  if (!/-/.test(row)) return false
  return /^[\s|:\-]+$/.test(row)
}

function check(file: string): Issue[] {
  const src = readFileSync(path.join(ROOT, file), "utf8")
  const lines = src.split("\n")
  const issues: Issue[] = []
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trim = line.trim()
    // Track fenced code blocks so we don't lint tables inside them.
    const fenceMatch = trim.match(/^(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (fence === null) fence = marker
      else if (marker === fence) fence = null
      continue
    }
    if (fence !== null) continue
    if (!line.trimStart().startsWith("|")) continue

    if (isSep(line)) {
      const cells = split(line.trim())
      for (const cell of cells) {
        // Cells must be exactly ---, :---, ---: or :---: with no surrounding
        // whitespace. Anything longer (or with space padding) is column-width
        // alignment and re-pads on every content change.
        if (!ok.has(cell)) {
          issues.push({
            file,
            line: i + 1,
            kind: "separator",
            detail: `separator cell "${cell}" is padded or extended — use ---, :---, ---: or :---: with no surrounding spaces`,
          })
          break
        }
      }
      continue
    }

    // Content row: detect padding (>1 space between content and pipe).
    // Only inspect lines that look like table rows: starts and ends with `|`.
    if (!line.trimStart().startsWith("|") || !line.trimEnd().endsWith("|")) continue
    const cells = split(line.trim())
    for (const cell of cells) {
      if (cell.trim() === "") continue
      const leading = cell.match(/^ */)![0].length
      const trailing = cell.match(/ *$/)![0].length
      if (leading > 1 || trailing > 1) {
        issues.push({
          file,
          line: i + 1,
          kind: "content",
          detail: `content cell "${cell}" has extra padding — use a single space on each side`,
        })
        break
      }
    }
  }
  return issues
}

function fixSepCell(raw: string) {
  const t = raw.trim()
  const left = t.startsWith(":")
  const right = t.endsWith(":")
  if (left && right) return ":---:"
  if (left) return ":---"
  if (right) return "---:"
  return "---"
}

function rewriteRow(row: string, separator: boolean) {
  // Preserve leading whitespace of the row itself (table indentation).
  const indent = row.match(/^\s*/)![0]
  const body = row.slice(indent.length)
  const cells = split(body)
  if (cells.length === 0) return row
  if (separator) return `${indent}|${cells.map(fixSepCell).join("|")}|`
  return `${indent}| ${cells.map((c) => c.trim()).join(" | ")} |`
}

function fix(file: string) {
  const src = readFileSync(path.join(ROOT, file), "utf8")
  const lines = src.split("\n")
  let changed = false
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trim = line.trim()
    const fenceMatch = trim.match(/^(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (fence === null) fence = marker
      else if (marker === fence) fence = null
      continue
    }
    if (fence !== null) continue
    if (!line.trimStart().startsWith("|")) continue
    if (!line.trimEnd().endsWith("|")) continue

    const sep = isSep(line)
    const next = rewriteRow(line, sep)
    if (next !== line) {
      lines[i] = next
      changed = true
    }
  }
  if (changed) writeFileSync(path.join(ROOT, file), lines.join("\n"))
  return changed
}

const argv = process.argv.slice(2)
const fixFlag = argv.includes("--fix")
const paths = argv.filter((a) => a !== "--fix")
const files = (paths.length > 0 ? paths : tracked()).filter((f) => !skip(f))

if (fixFlag) {
  let n = 0
  for (const f of files) if (fix(f)) n++
  console.log(`check-md-table-padding --fix: rewrote ${n} file(s).`)
  process.exit(0)
}

const all: Issue[] = []
for (const f of files) {
  for (const issue of check(f)) all.push(issue)
}

if (all.length === 0) {
  console.log(`check-md-table-padding: ${files.length} file(s) checked, no padded tables found.`)
  process.exit(0)
}

for (const i of all) {
  console.error(`${i.file}:${i.line} [${i.kind}] ${i.detail}`)
}
console.error("")
console.error(`Found ${all.length} padded table row(s) across ${new Set(all.map((i) => i.file)).size} file(s).`)
console.error("Fix: rewrite the table separator as |---|---| and use single-space padding on content cells.")
console.error("Or run: bun run script/check-md-table-padding.ts --fix")
console.error("See AGENTS.md > Markdown Tables.")
process.exit(1)
