/**
 * Kilo's diff against the pinned upstream release, limited to shared upstream files.
 *
 * Used by `script/check-opencode-annotations.ts` (every Kilo line in a shared file is marked) and
 * `script/check-shared-patches.ts` (the shared-patch counter, unit U-L3-01).
 */

import { $ } from "bun"
import path from "node:path"
import { defaultConfig } from "./config"
import { matches } from "./match"
import { isGenerated, isKiloOwned } from "./owned"

export interface SharedFile {
  path: string
  /** A: added by Kilo, M: modified, D: deleted by Kilo */
  status: "A" | "M" | "D"
  /** Added lines (not empty) that a marker covers, marker lines included */
  marked: number
  /** Added lines (not empty) that no marker covers */
  unmarked: { line: number; text: string }[]
  /** Upstream lines that Kilo removed */
  removed: number
  /** Generated file (see utils/owned.ts): listed, but not marked and not counted */
  generated: boolean
}

export interface SharedInput {
  /** Upstream release commit to compare against */
  pin: string
  /** Kilo revision. Omit to compare the working tree, untracked files included */
  ref?: string
  /** Repository root */
  cwd: string
}

export async function sharedFiles(input: SharedInput): Promise<SharedFile[]> {
  const upstream = new Set(
    (await $`git ls-tree -r -z --name-only ${input.pin}`.cwd(input.cwd).quiet().text()).split("\0").filter(Boolean),
  )
  const range = input.ref ? [input.pin, input.ref] : [input.pin]
  const status = (await $`git diff --name-status -z --no-renames ${range}`.cwd(input.cwd).quiet().text()).split("\0")
  const tracked = Array.from({ length: Math.floor(status.length / 2) }, (_, i) => ({
    status: status[i * 2] ?? "",
    path: status[i * 2 + 1] ?? "",
  }))
  const untracked = input.ref
    ? []
    : (await $`git ls-files --others --exclude-standard -z`.cwd(input.cwd).quiet().text())
        .split("\0")
        .filter(Boolean)
        .map((file) => ({ status: "A", path: file }))

  // Paths in `skipFiles` are upstream product areas that Kilo removed on purpose. The sync removes them again, so
  // they are not shared patches.
  const files = [...tracked, ...untracked].filter(
    (item) =>
      item.path &&
      ["A", "M", "D", "T"].includes(item.status) &&
      !isKiloOwned(item.path, upstream) &&
      !matches(item.path, defaultConfig.skipFiles),
  )
  // T (type change, for example file to symlink) counts as a modification.
  return Promise.all(
    files.map((item) => analyzeFile(input, item.path, item.status === "T" ? "M" : (item.status as SharedFile["status"]))),
  )
}

async function analyzeFile(input: SharedInput, file: string, status: SharedFile["status"]): Promise<SharedFile> {
  const generated = isGenerated(file)
  if (status === "D" || generated) return { path: file, status, marked: 0, unmarked: [], removed: 0, generated }

  const text = await content(input, file)
  if (text === undefined)
    return { path: file, status, marked: 0, unmarked: [{ line: 0, text: "(binary file)" }], removed: 0, generated }

  const diff = await addedLines(input, file, status, text)
  const lines = text.split(/\r?\n/)
  const covered = coveredLines(lines, status === "A")
  const added = [...diff.added].filter((n) => (lines[n - 1] ?? "").trim() !== "")
  return {
    path: file,
    status,
    marked: added.filter((n) => covered.has(n)).length,
    unmarked: added.filter((n) => !covered.has(n)).map((n) => ({ line: n, text: (lines[n - 1] ?? "").trim() })),
    removed: diff.removed,
    generated,
  }
}

/** File text at the Kilo revision, or undefined for binary files */
async function content(input: SharedInput, file: string) {
  const data = input.ref
    ? (await $`git show ${`${input.ref}:${file}`}`.cwd(input.cwd).quiet()).stdout
    : Buffer.from(await Bun.file(path.join(input.cwd, file)).arrayBuffer())
  if (data.includes(0)) return undefined
  return data.toString("utf8")
}

async function addedLines(input: SharedInput, file: string, status: SharedFile["status"], text: string) {
  const range = input.ref ? [input.pin, input.ref] : [input.pin]
  const tracked = input.ref || status === "M" || (await exists(input, file))
  if (!tracked) {
    return { added: new Set(text.split(/\r?\n/).map((_, i) => i + 1)), removed: 0 }
  }
  const diff = await $`git diff --unified=0 --no-renames ${range} -- ${file}`.cwd(input.cwd).quiet().text()
  return parseDiff(diff)
}

async function exists(input: SharedInput, file: string) {
  const result = await $`git ls-files --error-unmatch ${file}`.cwd(input.cwd).quiet().nothrow()
  return result.exitCode === 0
}

/** Parse a `--unified=0` diff into the added line numbers (new side) and the removed line count */
export function parseDiff(diff: string) {
  const added = new Set<number>()
  let removed = 0
  let next = 0
  let body = false
  for (const line of diff.split("\n")) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      next = Number(hunk[1])
      body = true
      continue
    }
    // File headers (`--- a/x`, `+++ b/x`) come only before the first hunk. Inside a hunk, an added
    // line such as `++i` is serialized as `+++i` and must count.
    if (!body) continue
    if (line.startsWith("+")) added.add(next++)
    else if (line.startsWith("-")) removed++
  }
  return { added, removed }
}

// A `kilocode_change` marker in JS (//), block or JSX ({/* */}), YAML/TOML/shell (#), or HTML/Markdown (<!-- -->) comments.
const MARKER = /(?:\/\/|\{?\s*\/\*|#|<!--)\s*kilocode_change\b/
const START = /(?:\/\/|\{?\s*\/\*|#|<!--)\s*kilocode_change\s+start\b/
const END = /(?:\/\/|\{?\s*\/\*|#|<!--)\s*kilocode_change\s+end\b/
const NEW_FILE = /(?:\/\/|\{?\s*\/\*|#|<!--)\s*kilocode_change\s*-\s*new\s*file\b/

export function hasMarker(line: string) {
  return MARKER.test(line)
}

/**
 * Line numbers (1-based) that a marker covers:
 * - a line with an inline marker, or a marker line itself
 * - every line inside a `kilocode_change start` / `kilocode_change end` block. A block without its
 *   `end` covers nothing, so a lost `end` cannot hide the rest of the file
 * - every line of a new file (`fresh`: not in upstream) whose first non-shebang, non-empty line is
 *   `kilocode_change - new file`. On a file that exists upstream this header covers only its own line
 */
export function coveredLines(lines: string[], fresh = true) {
  const covered = new Set<number>()
  const first = lines.find((line) => line.trim() !== "" && !line.startsWith("#!"))
  if (fresh && first && NEW_FILE.test(first)) return new Set(lines.map((_, i) => i + 1))

  const open: number[] = []
  let block = false
  lines.forEach((line, i) => {
    if (START.test(line)) block = true
    if (block) open.push(i + 1)
    if (!block && MARKER.test(line)) covered.add(i + 1)
    if (block && END.test(line)) {
      open.forEach((n) => covered.add(n))
      open.length = 0
      block = false
    }
  })
  // An unterminated block: only marker lines count.
  open.filter((n) => MARKER.test(lines[n - 1] ?? "")).forEach((n) => covered.add(n))
  return covered
}
