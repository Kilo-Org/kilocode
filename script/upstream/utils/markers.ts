#!/usr/bin/env bun
/**
 * Shared kilocode_change marker helpers used by both the marker fixer and the
 * reset-candidate classifier. The logic here was originally inlined in
 * fix-kilocode-markers.ts.
 */

import { $ } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

export interface Text {
  lines: string[]
  eol: string
  final: boolean
}

export interface Clean {
  text: Text
  marks: Marks
}

export interface Diff {
  lines: Set<number>
  deleted: number
}

export interface Range {
  start: number
  end: number
}

export interface Block extends Range {
  before: string
  after: string
}

export interface Marks {
  inline: Map<number, string>
  starts: Map<number, string>
  ends: Map<number, string>
  blocks: Block[]
  file?: string
}

export type Style = "slash" | "hash" | "jsx" | "block"

export const standalone = [
  /^\s*\/\/\s*kilocode_change\b.*$/,
  /^\s*#\s*kilocode_change\b.*$/,
  /^\s*\{?\s*\/\*\s*kilocode_change\b.*\*\/\}?\s*$/,
]
export const start = /\bkilocode_change\s+start\b/
export const end = /\bkilocode_change\s+end\b/
export const freshmark = /\bkilocode_change\s*-\s*new\s*file\b/
export const unsupported = new Set([".json", ".jsonc", ".lock", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico"])
export const styles = new Map<string, Style>([
  [".ts", "slash"],
  [".tsx", "slash"],
  [".js", "slash"],
  [".jsx", "slash"],
  [".css", "block"],
  [".yml", "hash"],
  [".yaml", "hash"],
  [".toml", "hash"],
  [".sh", "hash"],
  [".bash", "hash"],
  [".zsh", "hash"],
])
export const exempt = ["script/upstream/"]

export function ext(file: string) {
  return path.extname(file).toLowerCase()
}

export function supported(file: string, text: string) {
  const kind = ext(file)
  if (unsupported.has(kind)) return false
  if (styles.has(kind)) return true
  return !kind && text.startsWith("#!")
}

export function annotates(file: string) {
  return !exempt.some((scope) => file.startsWith(scope))
}

export function binary(data: Uint8Array) {
  return data.includes(0)
}

export function split(text: string): Text {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const final = text.endsWith("\n")
  const body = final ? text.slice(0, text.endsWith("\r\n") ? -2 : -1) : text
  return { lines: body ? body.split(/\r?\n/) : [], eol, final }
}

export function join(text: Text) {
  return text.lines.join(text.eol) + (text.final ? text.eol : "")
}

function strip(file: string, line: string): { line: string | null; mark?: string } {
  if (standalone.some((item) => item.test(line))) return { line: null }
  if (style(file) === "hash") return comment(line, [/^#\s*kilocode_change\b/])
  return comment(line, [/^\{\/\*\s*kilocode_change\b/, /^\/\*\s*kilocode_change\b/, /^\/\/\s*kilocode_change\b/])
}

function comment(line: string, tokens: RegExp[]) {
  let quote = ""
  let escape = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (!char) continue

    if (quote) {
      if (escape) {
        escape = false
        continue
      }
      if (char === "\\") {
        escape = true
        continue
      }
      if (char === quote) quote = ""
      continue
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char
      continue
    }

    const rest = line.slice(i)
    if (tokens.some((item) => item.test(rest))) {
      const next = line.slice(0, i).trimEnd()
      return { line: next, mark: line.slice(next.length) }
    }
  }

  return { line }
}

export function clean(file: string, text: string): Clean {
  const parsed = split(text)
  const marks: Marks = { inline: new Map(), starts: new Map(), ends: new Map(), blocks: [] }
  const lines: string[] = []
  const opens: { before: string; start?: number }[] = []

  for (const line of parsed.lines) {
    if (standalone.some((item) => item.test(line))) {
      if (freshmark.test(line)) marks.file = line
      if (start.test(line)) {
        opens.push({ before: line })
        continue
      }
      if (end.test(line)) {
        const open = opens.pop()
        const last = lines.length - 1
        if (open?.start !== undefined && last >= open.start) {
          marks.ends.set(last, line)
          marks.blocks.push({ start: open.start, end: last, before: open.before, after: line })
        }
        if (!open && last >= 0) marks.ends.set(last, line)
        continue
      }
      continue
    }

    const next = strip(file, line)
    if (next.line === null) continue

    const index = lines.length
    lines.push(next.line)

    for (const open of opens) {
      if (open.start !== undefined) continue
      open.start = index
      marks.starts.set(index, open.before)
    }

    if (next.mark) marks.inline.set(index, next.mark)
  }

  return { text: { ...parsed, lines }, marks }
}

export function style(file: string): Style {
  const kind = ext(file)
  return styles.get(kind) ?? "hash"
}

function context(file: string, text: Text, range: Range): Style {
  const base = style(file)
  if (![".tsx", ".jsx"].includes(ext(file))) return base

  if (tag(text.lines, range.start)) return "block"
  if (child(text.lines, range.start)) return "jsx"
  return base
}

function nearby(lines: string[], start: number, step: number) {
  for (let i = start; i >= 0 && i < lines.length; i += step) {
    const line = lines[i]?.trim()
    if (line) return line
  }
  return ""
}

function tag(lines: string[], start: number) {
  const current = lines[start]?.trim() ?? ""
  if (!current) return false
  if (/^[A-Za-z_$][\w$.:/-]*(=|\s*=)/.test(current)) return true

  for (let i = start - 1; i >= Math.max(0, start - 20); i--) {
    const line = lines[i]?.trim() ?? ""
    if (!line) continue
    if (line.includes(">")) return false
    if (/^<\/?[A-Za-z]/.test(line)) return true
  }

  return false
}

function child(lines: string[], start: number) {
  const current = lines[start]?.trim() ?? ""
  const prev = nearby(lines, start - 1, -1)
  const next = nearby(lines, start + 1, 1)

  if (prev.endsWith(">") && !prev.endsWith("=>")) return true
  if (next.startsWith("</")) return true
  if (current.startsWith("</")) return true
  if (current.startsWith("<") && prev && !prev.endsWith("(") && !prev.endsWith("return (")) return true
  return false
}

function block(mode: Style, pad: string) {
  if (mode === "hash") return { start: `${pad}# kilocode_change start`, end: `${pad}# kilocode_change end` }
  if (mode === "jsx") return { start: `${pad}{/* kilocode_change start */}`, end: `${pad}{/* kilocode_change end */}` }
  if (mode === "block") return { start: `${pad}/* kilocode_change start */`, end: `${pad}/* kilocode_change end */` }
  return { start: `${pad}// kilocode_change start`, end: `${pad}// kilocode_change end` }
}

function note(mode: Style) {
  if (mode === "hash") return " # kilocode_change"
  if (mode === "jsx") return " {/* kilocode_change */}"
  if (mode === "block") return " /* kilocode_change */"
  return " // kilocode_change"
}

function indent(line: string) {
  return line.match(/^\s*/)?.[0] ?? ""
}

function inline(file: string, _lines: string[], _range: Range, mode: Style) {
  if (mode === "hash") return true
  if (mode === "block" || mode === "jsx") return false
  if (![".tsx", ".jsx"].includes(ext(file))) return true
  return true
}

function merge(items: Range[]) {
  return [...items]
    .sort((a, b) => a.start - b.start)
    .reduce<Range[]>((acc, item) => {
      const prev = acc.at(-1)
      if (prev && item.start <= prev.end + 1) {
        prev.end = Math.max(prev.end, item.end)
        return acc
      }
      acc.push({ ...item })
      return acc
    }, [])
}

export function ranges(nums: Set<number>): Range[] {
  const sorted = [...nums].sort((a, b) => a - b)
  return merge(
    sorted.reduce<Range[]>((acc, num) => {
      const prev = acc.at(-1)
      if (prev && num === prev.end + 1) {
        prev.end = num
        return acc
      }
      acc.push({ start: num, end: num })
      return acc
    }, []),
  )
}

function expand(found: Range[], marks: Marks) {
  return merge(
    found.map((range) => {
      const next = { ...range }
      for (const block of marks.blocks) {
        if (next.end < block.start || next.start > block.end) continue
        next.start = Math.min(next.start, block.start)
        next.end = Math.max(next.end, block.end)
      }
      return next
    }),
  )
}

function boundary(line: string | undefined, kind: RegExp) {
  if (!line) return false
  return standalone.some((item) => item.test(line)) && kind.test(line)
}

function gap(lines: string[], index: number) {
  const next = lines.slice(index).findIndex((line) => line.trim() !== "")
  return next === -1 ? -1 : index + next
}

function collapse(lines: string[]): string[] {
  const index = lines.findIndex((line, pos) => {
    if (!boundary(line, end)) return false
    const next = gap(lines, pos + 1)
    return next !== -1 && boundary(lines[next], start)
  })
  if (index === -1) return lines

  const next = gap(lines, index + 1)
  return collapse(lines.filter((_, pos) => pos !== index && pos !== next))
}

function saved(marks: Marks, range: Range) {
  return marks.blocks.find((block) => block.start === range.start && block.end === range.end)
}

export function annotate(file: string, clean: Clean, found: Range[]) {
  const text = clean.text
  const marks = clean.marks
  const lines = [...text.lines]

  for (const range of expand(found, marks).reverse()) {
    const mode = context(file, text, range)
    const prior = saved(marks, range)
    const before = prior?.before ?? marks.starts.get(range.start)
    const after = prior?.after ?? marks.ends.get(range.end)

    if (!before && !after && range.start === range.end && inline(file, text.lines, range, mode)) {
      lines[range.start] = `${lines[range.start]}${marks.inline.get(range.start) ?? note(mode)}`
      continue
    }

    const pad = indent(text.lines[range.start] ?? "")
    const fallback = block(mode, pad)
    const pair = {
      start: before ?? fallback.start,
      end: after ?? fallback.end,
    }
    lines.splice(range.end + 1, 0, pair.end)
    lines.splice(range.start, 0, pair.start)
  }

  return join({ ...text, lines: collapse(lines) })
}

export function fresh(file: string, clean: Clean) {
  const lines = [...clean.text.lines]
  const mode = style(file)
  const line = clean.marks.file ?? (mode === "hash" ? "# kilocode_change - new file" : "// kilocode_change - new file")
  const at = lines[0]?.startsWith("#!") ? 1 : 0
  lines.splice(at, 0, line)
  return join({ ...clean.text, lines })
}

function patch(out: string): Diff {
  const lines = new Set<number>()
  const state = { next: 0, deleted: 0, added: 0, removed: 0 }
  const flush = () => {
    if (state.removed > 0 && state.added === 0) state.deleted += state.removed
    state.added = 0
    state.removed = 0
  }

  for (const line of out.split("\n")) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (hunk) {
      flush()
      state.next = Number(hunk[1]) - 1
      continue
    }

    if (line.startsWith("+++") || line.startsWith("---")) continue
    if (line.startsWith("+")) {
      if (line.slice(1).trim()) lines.add(state.next)
      state.added++
      state.next++
      continue
    }
    if (line.startsWith("-")) {
      state.removed++
      continue
    }
    if (line.startsWith(" ")) state.next++
  }

  flush()
  return { lines, deleted: state.deleted }
}

export async function changed(base: Text, head: Text, opts?: { ignoreWhitespace?: boolean }): Promise<Diff> {
  const dir = await mkdtemp(path.join(tmpdir(), "kilo-markers-"))
  const left = path.join(dir, "upstream")
  const right = path.join(dir, "current")

  try {
    await Bun.write(left, join({ ...base, eol: "\n" }))
    await Bun.write(right, join({ ...head, eol: "\n" }))

    const result = opts?.ignoreWhitespace
      ? await $`git diff --no-index --no-ext-diff -w --unified=0 -- ${left} ${right}`.quiet().nothrow()
      : await $`git diff --no-index --no-ext-diff --unified=0 -- ${left} ${right}`.quiet().nothrow()
    if (result.exitCode === 0) return { lines: new Set(), deleted: 0 }
    if (result.exitCode === 1) return patch(result.stdout.toString())
    throw new Error(result.stderr.toString())
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Pure in-process line-diff used by bulk classifiers. Returns the number of
 * non-matching lines between two texts using a multiset approach (moving a line
 * around doesn't count as drift). Whitespace can optionally be ignored.
 *
 * Unlike `changed()`, this spawns no subprocesses so it is safe to run
 * concurrently without risking pipe-buffer deadlocks on large inputs.
 */
export function approxDiff(base: string, head: string, opts?: { ignoreWhitespace?: boolean }): number {
  if (base === head) return 0
  const norm = opts?.ignoreWhitespace ? (line: string) => line.replace(/\s+/g, " ").trim() : (line: string) => line
  const counts = new Map<string, number>()
  for (const line of base.split(/\r?\n/)) {
    const key = norm(line)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const line of head.split(/\r?\n/)) {
    const key = norm(line)
    counts.set(key, (counts.get(key) ?? 0) - 1)
  }
  let total = 0
  for (const v of counts.values()) total += Math.abs(v)
  return total
}
