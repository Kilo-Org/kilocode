#!/usr/bin/env bun
/**
 * Rebuild kilocode_change markers for one file by comparing it with the last
 * merged upstream version.
 *
 * Usage:
 *   bun run script/upstream/fix-kilocode-markers.ts packages/opencode/src/file.ts
 *   bun run script/upstream/fix-kilocode-markers.ts packages/opencode/src/file.ts --dry-run
 */

import { $ } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { compareVersions, parseVersion, type VersionInfo } from "./utils/version"
import { isAncestor } from "./utils/git"
import { error, header, info, success, warn } from "./utils/logger"
import { transformI18nContent } from "./transforms/transform-i18n"
import { applyBrandingTransforms } from "./transforms/transform-take-theirs"
import { applyScriptTransforms } from "./transforms/transform-scripts"
import { applyTauriTransforms } from "./transforms/transform-tauri"
import { applyExtensionTransforms } from "./transforms/transform-extensions"
import { applyWebTransforms } from "./transforms/transform-web"
import { applyPackageNameTransforms } from "./transforms/package-names"

interface Args {
  file?: string
  dryRun: boolean
  help: boolean
}

interface Text {
  lines: string[]
  eol: string
  final: boolean
}

interface Clean {
  text: Text
  marks: Marks
}

interface Diff {
  lines: Set<number>
  deleted: number
}

interface Range {
  start: number
  end: number
}

interface Block extends Range {
  before: string
  after: string
}

interface Marks {
  inline: Map<number, string>
  starts: Map<number, string>
  ends: Map<number, string>
  blocks: Block[]
  file?: string
}

type Style = "slash" | "hash" | "jsx" | "block"

const standalone = [
  /^\s*\/\/\s*kilocode_change\b.*$/,
  /^\s*#\s*kilocode_change\b.*$/,
  /^\s*\{?\s*\/\*\s*kilocode_change\b.*\*\/\}?\s*$/,
]
const start = /\bkilocode_change\s+start\b/
const end = /\bkilocode_change\s+end\b/
const freshmark = /\bkilocode_change\s*-\s*new\s*file\b/
const unsupported = new Set([".json", ".jsonc", ".lock", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico"])
const styles = new Map<string, Style>([
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
const workflows = [".github/workflows/publish.yml", ".github/workflows/beta.yml"]
const url = "https://github.com/anomalyco/opencode.git"
const exempt = ["script/upstream/"]

function usage() {
  console.log(`Usage: bun run script/upstream/fix-kilocode-markers.ts <repo-relative-file> [--dry-run]

Rebuilds kilocode_change markers by:
  1. Finding the newest upstream tag whose commit is already merged into HEAD.
  2. Applying upstream merge branding transforms to that upstream file.
  3. Comparing the transformed upstream file with the current working tree file.
  4. Removing existing kilocode_change markers and adding fresh markers around remaining changed lines.

Options:
  --dry-run  Show what would change without writing the file.
  --help     Show this help message.`)
}

function args(): Args {
  const raw = process.argv.slice(2)
  return {
    file: raw.find((arg) => !arg.startsWith("--")),
    dryRun: raw.includes("--dry-run"),
    help: raw.includes("--help") || raw.includes("-h"),
  }
}

async function root() {
  return (await $`git rev-parse --show-toplevel`.text()).trim()
}

function normalize(root: string, file: string) {
  if (path.isAbsolute(file)) throw new Error("File must be relative to the repo root")
  if (file.includes("\0")) throw new Error("File path contains a null byte")

  const abs = path.resolve(root, file)
  const rel = path.relative(root, abs).replaceAll(path.sep, "/")

  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("File must stay inside the repo")
  return rel
}

function ext(file: string) {
  return path.extname(file).toLowerCase()
}

function supported(file: string, text: string) {
  const kind = ext(file)
  if (unsupported.has(kind)) return false
  if (styles.has(kind)) return true
  return !kind && text.startsWith("#!")
}

function annotates(file: string) {
  return !exempt.some((scope) => file.startsWith(scope))
}

async function translate(file: string, text: string) {
  const names = applyPackageNameTransforms(text).result
  const script = applyScriptTransforms(names).result
  const branded = applyBrandingTransforms(script).result
  const i18n = transformI18nContent(branded).result
  const tauri = applyTauriTransforms(i18n, file).result
  const ext = applyExtensionTransforms(tauri, file).result
  const web = applyWebTransforms(ext).result

  return workflow(file, web)
}

function workflow(file: string, text: string) {
  if (!workflows.includes(file)) return text
  return text
    .replace(/github\.repository == 'anomalyco\/opencode'/g, "github.repository == 'Kilo-Org/kilocode'")
    .replace(/github\.repository == "anomalyco\/opencode"/g, 'github.repository == "Kilo-Org/kilocode"')
    .replace(/\bopencode-ai\b/g, "@kilocode/cli")
    .replace(
      /GH_REPO:\s*\$\{\{ \(github\.ref_name == 'beta' && 'anomalyco\/opencode-beta'\) \|\| github\.repository \}\}/g,
      "GH_REPO: ${{ github.repository }}",
    )
}

function split(text: string): Text {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const final = text.endsWith("\n")
  const body = final ? text.slice(0, text.endsWith("\r\n") ? -2 : -1) : text
  return { lines: body ? body.split(/\r?\n/) : [], eol, final }
}

function join(text: Text) {
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

function clean(file: string, text: string): Clean {
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

async function last(): Promise<VersionInfo> {
  const source = await remote()

  info(`Fetching upstream tags from ${source}...`)
  const fetch = await $`git fetch ${source} --tags --force`.quiet().nothrow()
  if (fetch.exitCode !== 0) throw new Error(`Failed to fetch upstream: ${fetch.stderr.toString()}`)

  const versions = await list(source)
  for (const version of versions) {
    if (await isAncestor(version.commit, "HEAD")) return version
  }

  throw new Error("Could not find a merged upstream tag in HEAD")
}

async function remote() {
  const result = await $`git remote get-url upstream`.quiet().nothrow()
  if (result.exitCode === 0) return "upstream"

  warn(`No 'upstream' remote found; using ${url}`)
  return url
}

async function list(source: string): Promise<VersionInfo[]> {
  const result = await $`git ls-remote --tags ${source}`.quiet().nothrow()
  if (result.exitCode !== 0) throw new Error(`Failed to list upstream tags: ${result.stderr.toString()}`)

  const found = new Map<string, string>()
  for (const line of result.stdout.toString().trim().split("\n")) {
    const match = line.match(/^([a-f0-9]+)\s+refs\/tags\/([^^]+)(\^\{\})?$/)
    if (!match) continue

    const commit = match[1]
    const tag = match[2]
    const peeled = Boolean(match[3])
    if (commit && tag && (peeled || !found.has(tag))) found.set(tag, commit)
  }

  return [...found]
    .flatMap(([tag, commit]) => {
      const version = parseVersion(tag)
      return version ? [{ version, tag, commit }] : []
    })
    .sort((a, b) => compareVersions(b.version, a.version))
}

async function upstream(ref: string, file: string) {
  const spec = `${ref}:${file}`
  const result = await $`git show ${spec}`.quiet().nothrow()
  if (result.exitCode === 0) return result.stdout.toString()

  const stderr = result.stderr.toString()
  if (stderr.includes("exists on disk") || stderr.includes("does not exist") || stderr.includes("Path")) return null
  throw new Error(`Failed to read ${file} from ${ref}: ${stderr}`)
}

function style(file: string): Style {
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

function inline(file: string, lines: string[], range: Range, mode: Style) {
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

function ranges(nums: Set<number>): Range[] {
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

function annotate(file: string, clean: Clean, found: Range[]) {
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

function fresh(file: string, clean: Clean) {
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

async function changed(base: Text, head: Text): Promise<Diff> {
  const dir = await mkdtemp(path.join(tmpdir(), "kilo-markers-"))
  const left = path.join(dir, "upstream")
  const right = path.join(dir, "current")

  try {
    await Bun.write(left, join({ ...base, eol: "\n" }))
    await Bun.write(right, join({ ...head, eol: "\n" }))

    const result = await $`git diff --no-index --no-ext-diff --unified=0 -- ${left} ${right}`.quiet().nothrow()
    if (result.exitCode === 0) return { lines: new Set(), deleted: 0 }
    if (result.exitCode === 1) return patch(result.stdout.toString())
    throw new Error(result.stderr.toString())
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function main() {
  const opts = args()
  if (opts.help) {
    usage()
    return
  }
  if (!opts.file) {
    usage()
    process.exit(1)
  }

  const top = await root()
  process.chdir(top)

  const file = normalize(top, opts.file)
  const abs = path.join(top, file)
  const current = await Bun.file(abs).text()
  if (!supported(file, current)) throw new Error(`Cannot safely add comment markers to ${file}`)
  if (current.includes("\0")) throw new Error(`${file} appears to be binary`)

  header("Fix kilocode_change markers")

  const version = await last()
  success(`Last merged upstream: ${version.tag} (${version.commit.slice(0, 8)})`)

  const base = await upstream(version.commit, file)
  const head = clean(file, current)
  const baseText = base === null ? null : await translate(file, base)
  const diff = baseText === null ? null : await changed(clean(file, baseText).text, head.text)
  const found = ranges(diff?.lines ?? new Set())
  const next = base === null ? fresh(file, head) : annotate(file, head, found)

  if (base === null && annotates(file)) warn(`${file} does not exist upstream; marked as a new Kilo file`)
  if (base === null && !annotates(file)) warn(`${file} does not exist upstream`)
  if (diff && diff.deleted > 0)
    warn(`${diff.deleted} upstream-only deleted line(s) cannot be annotated in the current file`)
  if (!annotates(file)) warn(`${file} is exempt from annotation checks; this command still reports differences`)
  if (!annotates(file)) {
    success(`${file} differs from ${version.tag} in ${found.length} range(s)`)
    return
  }

  if (next === current) {
    success(`${file} already has normalized kilocode_change markers`)
    return
  }

  if (opts.dryRun) {
    info(`[DRY-RUN] Would update ${file}`)
    return
  }

  await Bun.write(abs, next)
  success(`Updated ${file}`)
}

main().catch((err) => {
  error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
