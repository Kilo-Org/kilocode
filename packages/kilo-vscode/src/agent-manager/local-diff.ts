import * as fs from "fs/promises"
import { binaryFile } from "../diff/shared/binary"
import { imageMime, loadImage, readImageFile } from "../diff/shared/image"
import { resolveInside } from "../diff/shared/path"
import type { GitOps } from "./GitOps"
import type { WorktreeDiffEntry } from "./types"

type Status = "added" | "deleted" | "modified"

type Meta = {
  file: string
  additions: number
  deletions: number
  status: Status
  tracked: boolean
  generatedLike: boolean
  binary: boolean
  stamp: string
}

type Log = (...args: unknown[]) => void

/** Cap untracked file reads so line-counting a multi-megabyte log file does
 *  not stall the poll. Matches `GitOps.workingTreeStats()`. */
const MAX_UNTRACKED_BYTES = 1_000_000
const MAX_UNTRACKED_OUTPUT_BYTES = 4_000_000
const MAX_UNTRACKED_ENTRIES = 10_000

/** Cap per-side reads in the detail view. Opening very large tracked files
 *  used to spike `kilo serve`; now that the detail path runs in the
 *  extension host, the same file would spike VS Code's RSS. Over this
 *  threshold we return a summarized entry (empty `before`/`after`/`patch`,
 *  metadata preserved) so the webview can render counts without
 *  materializing the content. */
export const MAX_DETAIL_BYTES = 20_000_000

/**
 * Local, Node.js-side replacement for the server's `WorktreeDiff.summary()` and
 * `WorktreeDiff.detail()` routes. Keeps Agent Manager polling out of the Bun
 * `kilo serve` process, which leaks native memory on every `Bun.spawn` on
 * Windows (oven-sh/bun#18265).
 *
 * All git calls go through `GitOps.execGit()` → `child_process.spawn` with
 * `windowsHide: true` and the shared semaphore. No Bun involvement.
 */

/** Ported from `packages/opencode/src/file/ignore.ts` — identical patterns,
 *  no runtime dependency on minimatch/picomatch. */
const FOLDERS = new Set([
  "node_modules",
  "bower_components",
  ".pnpm-store",
  "vendor",
  ".npm",
  "dist",
  "build",
  "out",
  ".next",
  "target",
  "bin",
  "obj",
  ".git",
  ".svn",
  ".hg",
  ".vscode",
  ".idea",
  ".turbo",
  ".output",
  "desktop",
  ".sst",
  ".cache",
  ".webkit-cache",
  "__pycache__",
  ".pytest_cache",
  "mypy_cache",
  ".history",
  ".gradle",
])

const SUFFIXES = [".swp", ".swo", ".pyc", ".log"]
const BASENAMES = new Set([".DS_Store", "Thumbs.db"])
const CONTAINS_SEGMENTS = ["logs", "tmp", "temp", "coverage", ".nyc_output"]

export function generatedLike(file: string): boolean {
  const parts = file.split(/[/\\]/)
  for (const part of parts) {
    if (FOLDERS.has(part)) return true
    if (CONTAINS_SEGMENTS.includes(part)) return true
  }
  for (const suffix of SUFFIXES) {
    if (file.endsWith(suffix)) return true
  }
  const base = parts[parts.length - 1] ?? ""
  if (BASENAMES.has(base)) return true
  return false
}

const BASE_CANDIDATES = ["main", "master", "dev", "develop"]

const ancCache = new Map<string, { anc: string; time: number }>()

export async function resolveBase(git: GitOps, dir: string, base: string): Promise<string> {
  // If the caller gave an explicit base, honor it. Return it as-is so merge-base
  // fails loudly on a stale/misspelled ref instead of silently diffing against
  // an unrelated candidate branch.
  if (base && base !== "HEAD") return base
  for (const name of BASE_CANDIDATES) {
    const ok = await git.execGit(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], dir)
    if (ok.code === 0) return name
  }
  return "HEAD"
}

async function ancestor(git: GitOps, dir: string, base: string, log?: Log): Promise<string | undefined> {
  const resolvedBase = await resolveBase(git, dir, base)
  const cacheKey = `${dir}\0${resolvedBase}`
  const cached = ancCache.get(cacheKey)
  if (cached && Date.now() - cached.time < 2000) return cached.anc

  const result = await git.execGit(["merge-base", "HEAD", resolvedBase], dir)
  if (result.code !== 0) {
    log?.("git merge-base failed", { code: result.code, stderr: result.stderr.trim(), dir, base, resolvedBase })
    return undefined
  }
  const anc = result.stdout.trim()
  ancCache.set(cacheKey, { anc, time: Date.now() })
  if (ancCache.size > 32) ancCache.delete(ancCache.keys().next().value!)
  return anc
}

export function splitPatches(patchText: string, files: string[]): Map<string, string> {
  const map = new Map<string, string>()
  if (!patchText || files.length === 0) return map
  const names = new Map(files.map((file) => [`diff --git a/${file} b/${file}`, file]))
  const headers = [...patchText.matchAll(/^diff --git a\/.* b\/.*$/gm)]
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]!
    const file = names.get(header[0])
    if (!file || header.index === undefined) continue
    map.set(file, patchText.slice(header.index, headers[i + 1]?.index ?? patchText.length))
  }
  return map
}

export function requiresContents(file: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(file)
}

function parseNumstatOutput(stdout: string) {
  const map = new Map<string, { additions: number; deletions: number; binary: boolean }>()
  for (const line of stdout.trim().split("\n")) {
    if (!line) continue
    const parts = line.split("\t")
    if (parts.length < 3) continue
    const add = parts[0]
    const del = parts[1]
    const name = parts.slice(2).join("\t")
    if (!name) continue
    map.set(name, {
      additions: add === "-" ? 0 : parseInt(add || "0", 10) || 0,
      deletions: del === "-" ? 0 : parseInt(del || "0", 10) || 0,
      binary: add === "-" || del === "-",
    })
  }
  return map
}

async function numstat(git: GitOps, dir: string, base: string, file?: string) {
  const args = ["-c", "core.quotepath=false", "diff", "--numstat", "--no-renames", base]
  if (file) args.push("--", file)
  const result = await git.execGit(args, dir)
  if (result.code !== 0) return new Map<string, { additions: number; deletions: number; binary: boolean }>()
  return parseNumstatOutput(result.stdout)
}

async function statStamp(dir: string, file: string): Promise<string> {
  const full = resolveInside(dir, file)
  if (!full) return `missing:${file}`
  const stat = await fs.lstat(full).catch(() => undefined)
  if (!stat) return `missing:${file}`
  return `${stat.size}:${stat.mtimeMs}`
}

function trackedStamp(status: Status, additions: number, deletions: number, anc: string, stat?: string): string {
  if (status === "deleted") return `deleted:${anc}`
  return `${status}:${additions}:${deletions}:${anc}${stat ? `:${stat}` : ""}`
}

async function lineCount(file: string): Promise<number> {
  const stat = await fs.lstat(file).catch(() => undefined)
  if (!stat || stat.size === 0) return 0
  if (stat.size > MAX_UNTRACKED_BYTES) return 0
  const content = stat.isSymbolicLink()
    ? await fs.readlink(file).catch(() => "")
    : await fs.readFile(file, "utf-8").catch(() => "")
  if (!content) return 0
  if (content.endsWith("\n")) return content.split("\n").length - 1
  return content.split("\n").length
}

function statusFromCode(code: string): Status {
  if (code === "A") return "added"
  if (code === "D") return "deleted"
  return "modified"
}

async function list(git: GitOps, dir: string, anc: string, log?: Log): Promise<WorktreeDiffEntry[]> {
  const [patchResult, nameStatus, numstatResult, untracked] = await Promise.all([
    git.execGit(["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--no-renames", "-U3", anc], dir, {
      maxOutput: MAX_DETAIL_BYTES,
    }),
    git.execGit(["-c", "core.quotepath=false", "diff", "--name-status", "--no-renames", anc], dir),
    git.execGit(["-c", "core.quotepath=false", "diff", "--numstat", "--no-renames", anc], dir),
    git.execGit(["ls-files", "--others", "--exclude-standard"], dir, { maxOutput: MAX_UNTRACKED_OUTPUT_BYTES }),
  ])

  if (nameStatus.code !== 0) {
    log?.("git diff --name-status failed", { code: nameStatus.code, stderr: nameStatus.stderr.trim() })
    return []
  }

  const tracked = nameStatus.stdout
    .trim()
    .split("\n")
    .flatMap((line) => {
      if (!line) return []
      const parts = line.split("\t")
      const code = parts[0]
      const file = parts.slice(1).join("\t")
      return file && code ? [{ file, code }] : []
    })
  const counts = numstatResult.code === 0 ? parseNumstatOutput(numstatResult.stdout) : new Map()
  const patches = splitPatches(
    patchResult.code === 0 ? patchResult.stdout : "",
    tracked.map((item) => item.file),
  )
  const result: WorktreeDiffEntry[] = []
  const seen = new Set<string>()
  const stampTasks: Promise<void>[] = []

  for (const { file, code } of tracked) {
    seen.add(file)
    const status = statusFromCode(code)
    const stat = counts.get(file) ?? { additions: 0, deletions: 0, binary: false }
    const mime = imageMime(file)
    const patch = patches.get(file)
    const summarized = mime !== undefined || stat.binary || patch === undefined || requiresContents(file)

    const entry: WorktreeDiffEntry = {
      file,
      patch: summarized ? "" : patch,
      before: "",
      after: "",
      additions: stat.additions,
      deletions: stat.deletions,
      status,
      tracked: true,
      generatedLike: generatedLike(file),
      summarized,
      stamp: trackedStamp(status, stat.additions, stat.deletions, anc),
      kind: mime ? "image" : undefined,
    }
    result.push(entry)

    if (status !== "deleted" && summarized) {
      stampTasks.push(
        statStamp(dir, file).then((s) => {
          entry.stamp = trackedStamp(status, stat.additions, stat.deletions, anc, s)
        }),
      )
    }
  }

  if (untracked.code !== 0) {
    log?.("git ls-files --others failed", { code: untracked.code, stderr: untracked.stderr.trim() })
  }
  const untrackedFiles =
    untracked.code === 0 ? untracked.stdout.trim().split("\n").filter(Boolean).slice(0, MAX_UNTRACKED_ENTRIES) : []
  const entries: WorktreeDiffEntry[] = []
  let remaining = MAX_DETAIL_BYTES
  for (const file of untrackedFiles) {
    if (seen.has(file)) continue
    const result = await untrackedEntry(dir, file, remaining)
    if (!result) continue
    entries.push(result.entry)
    remaining -= result.cost
  }

  await Promise.all(stampTasks)
  result.push(...entries)
  return result
}

async function untrackedEntry(
  dir: string,
  file: string,
  remaining: number,
): Promise<{ entry: WorktreeDiffEntry; cost: number } | undefined> {
  const full = resolveInside(dir, file)
  if (!full) return undefined
  const stat = await fs.lstat(full).catch(() => undefined)
  if (!stat) return undefined

  const binary = await binaryFile(full)
  const mime = imageMime(file)
  const canRead = !mime && !binary && stat.size <= MAX_UNTRACKED_BYTES && stat.size * 2 <= remaining
  const content = canRead
    ? stat.isSymbolicLink()
      ? await fs.readlink(full).catch(() => "")
      : await fs.readFile(full, "utf-8").catch(() => "")
    : ""
  const patch = canRead ? buildUntrackedPatch(file, content) : ""
  const summarized = !canRead

  return {
    entry: {
      file,
      patch,
      before: "",
      after: requiresContents(file) && canRead ? content : "",
      additions: canRead ? linesOf(content) : 0,
      deletions: 0,
      status: "added",
      tracked: false,
      generatedLike: generatedLike(file),
      summarized,
      stamp: `${stat.size}:${stat.mtimeMs}`,
      kind: mime ? "image" : undefined,
    },
    cost: canRead ? Math.max(stat.size * 2, patch.length) : 0,
  }
}

function summarize(meta: Meta): WorktreeDiffEntry {
  const image = imageMime(meta.file) !== undefined
  return {
    file: meta.file,
    patch: "",
    before: "",
    after: "",
    additions: meta.additions,
    deletions: meta.deletions,
    status: meta.status,
    tracked: meta.tracked,
    generatedLike: meta.generatedLike,
    summarized: image || !meta.binary,
    stamp: meta.stamp,
    kind: image ? "image" : undefined,
  }
}

/**
 * Fast unified diff path. Returns one entry per changed file (tracked or
 * untracked) relative to `merge-base HEAD base`, with complete hunk patches
 * populated for instant rendering.
 */
export async function diffSummary(git: GitOps, dir: string, base: string, log?: Log): Promise<WorktreeDiffEntry[]> {
  const anc = await ancestor(git, dir, base, log)
  if (!anc) return []
  return await list(git, dir, anc, log)
}

export function createLocalDiff(git: GitOps, log?: Log) {
  const states = new Map<string, { anc: string; entries: Map<string, WorktreeDiffEntry> }>()

  return {
    summary: async (dir: string, base: string): Promise<WorktreeDiffEntry[]> => {
      const id = `${dir}\0${base}`
      const anc = await ancestor(git, dir, base, log)
      if (!anc) {
        states.delete(id)
        return []
      }

      const items = await list(git, dir, anc, log)
      states.delete(id)
      states.set(id, { anc, entries: new Map(items.map((item) => [item.file ?? "", item])) })
      if (states.size > 8) states.delete(states.keys().next().value!)
      return items
    },
    file: async (dir: string, base: string, file: string): Promise<WorktreeDiffEntry | null> => {
      const state = states.get(`${dir}\0${base}`)
      if (state) {
        const cached = state.entries.get(file)
        if (cached && !cached.kind && cached.patch) {
          const status = cached.status ?? "modified"
          const before = await readBefore(git, dir, state.anc, file, status)
          const after = await readAfter(dir, file, status)
          return {
            ...cached,
            before,
            after,
            summarized: false,
          }
        }
      }
      return diffFile(git, dir, base, file, log)
    },
  }
}

async function detailMeta(git: GitOps, dir: string, anc: string, file: string): Promise<Meta | undefined> {
  const full = resolveInside(dir, file)
  if (!full) return undefined
  const tracked = await git.execGit(["ls-files", "--error-unmatch", "--", file], dir)
  if (tracked.code !== 0) {
    const untracked = await git.execGit(["ls-files", "--others", "--exclude-standard", "--", file], dir)
    if (untracked.code !== 0 || !untracked.stdout.split("\n").includes(file)) return undefined
    const exists = await fs.lstat(full).catch(() => undefined)
    if (!exists) return undefined
    const binary = await binaryFile(full)
    return {
      file,
      additions: binary ? 0 : await lineCount(full),
      deletions: 0,
      status: "added",
      tracked: false,
      generatedLike: generatedLike(file),
      binary,
      stamp: await statStamp(dir, file),
    }
  }

  const nameStatus = await git.execGit(
    ["-c", "core.quotepath=false", "diff", "--name-status", "--no-renames", anc, "--", file],
    dir,
  )
  if (nameStatus.code !== 0) return undefined
  const line = nameStatus.stdout.trim().split("\n")[0]
  if (!line) return undefined
  const parts = line.split("\t")
  const code = parts[0]
  const pathPart = parts.slice(1).join("\t") || file
  if (!code) return undefined

  const counts = await numstat(git, dir, anc, file)
  const stat = counts.get(file) ?? counts.get(pathPart) ?? { additions: 0, deletions: 0, binary: false }
  const status = statusFromCode(code)
  return {
    file: pathPart,
    additions: stat.additions,
    deletions: stat.deletions,
    status,
    tracked: true,
    generatedLike: generatedLike(pathPart),
    binary: stat.binary,
    stamp: trackedStamp(status, stat.additions, stat.deletions, anc, await statStamp(dir, pathPart)),
  }
}

async function blobSize(git: GitOps, dir: string, anc: string, file: string): Promise<number> {
  const result = await git.execGit(["cat-file", "-s", `${anc}:${file}`], dir)
  if (result.code !== 0) return 0
  return parseInt(result.stdout.trim(), 10) || 0
}

async function fileSize(dir: string, file: string): Promise<number> {
  const full = resolveInside(dir, file)
  if (!full) return 0
  const stat = await fs.lstat(full).catch(() => undefined)
  return stat?.size ?? 0
}

async function readBlob(git: GitOps, dir: string, ref: string, file: string): Promise<Buffer | undefined> {
  const result = await git.execGitBuffer(["show", `${ref}:${file}`], dir)
  return result.code === 0 ? result.stdout : undefined
}

async function readFile(dir: string, file: string): Promise<Buffer | undefined> {
  const full = resolveInside(dir, file)
  if (!full) return undefined
  const stat = await fs.lstat(full).catch(() => undefined)
  if (!stat?.isFile()) return undefined
  return readImageFile(full)
}

async function readBefore(git: GitOps, dir: string, anc: string, file: string, status: Status): Promise<string> {
  if (status === "added") return ""
  const result = await git.execGit(["show", `${anc}:${file}`], dir)
  return result.code === 0 ? result.stdout : ""
}

async function readAfter(dir: string, file: string, status: Status): Promise<string> {
  if (status === "deleted") return ""
  const full = resolveInside(dir, file)
  if (!full) return ""
  const stat = await fs.lstat(full).catch(() => undefined)
  if (!stat) return ""
  if (stat.isSymbolicLink()) return fs.readlink(full).catch(() => "")
  if (!stat.isFile()) return ""
  return fs.readFile(full, "utf-8").catch(() => "")
}

async function unifiedPatch(git: GitOps, dir: string, anc: string, file: string): Promise<string> {
  const result = await git.execGit(
    ["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--no-renames", anc, "--", file],
    dir,
  )
  return result.code === 0 ? result.stdout : ""
}

function linesOf(text: string): number {
  if (!text) return 0
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length
}

/**
 * Single-file detail view (infrequent — opened on demand when the user clicks
 * a file in the review panel). Returns full `before`, `after`, and unified
 * patch. Returns `null` if the file cannot be resolved.
 */
export async function diffFile(
  git: GitOps,
  dir: string,
  base: string,
  file: string,
  log?: Log,
): Promise<WorktreeDiffEntry | null> {
  const anc = await ancestor(git, dir, base, log)
  if (!anc) return null
  const meta = await detailMeta(git, dir, anc, file)
  if (!meta) return null
  return materialize(git, dir, anc, meta, log)
}

async function materialize(git: GitOps, dir: string, anc: string, meta: Meta, log?: Log): Promise<WorktreeDiffEntry> {
  const mime = imageMime(meta.file)
  if (meta.binary && !mime) return summarize(meta)
  const beforeBytes = meta.status === "added" ? 0 : await blobSize(git, dir, anc, meta.file)
  const afterBytes = meta.status === "deleted" ? 0 : await fileSize(dir, meta.file)
  if (mime) {
    const image = await loadImage(
      meta.file,
      meta.status === "added" ? undefined : { bytes: beforeBytes, read: () => readBlob(git, dir, anc, meta.file) },
      meta.status === "deleted" ? undefined : { bytes: afterBytes, read: () => readFile(dir, meta.file) },
    )
    return { ...summarize(meta), summarized: false, image }
  }
  // Cheap size probe before materializing content — protects the extension
  // host from OOM on huge tracked files. `git cat-file -s` returns the blob
  // size without streaming its contents, and `fs.stat` is a plain syscall.
  if (beforeBytes > MAX_DETAIL_BYTES || afterBytes > MAX_DETAIL_BYTES) {
    log?.("diffFile: file too large for detail view, returning summarized entry", {
      file: meta.file,
      beforeBytes,
      afterBytes,
      cap: MAX_DETAIL_BYTES,
    })
    return summarize(meta)
  }

  const before = await readBefore(git, dir, anc, meta.file, meta.status)
  const after = await readAfter(dir, meta.file, meta.status)
  const patch = meta.tracked ? await unifiedPatch(git, dir, anc, meta.file) : buildUntrackedPatch(meta.file, after)
  const additions = meta.status === "added" && meta.additions === 0 && !meta.tracked ? linesOf(after) : meta.additions
  return {
    file: meta.file,
    patch,
    before,
    after,
    additions,
    deletions: meta.deletions,
    status: meta.status,
    tracked: meta.tracked,
    generatedLike: meta.generatedLike,
    summarized: false,
    stamp: meta.stamp,
  }
}

/** Synthesize a unified-diff patch for an untracked (new) file. `git diff`
 *  only covers tracked paths, so we render the "everything added" patch
 *  ourselves. Format matches `git diff --no-index /dev/null <file>`. */
function buildUntrackedPatch(file: string, content: string): string {
  if (!content) {
    return `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n`
  }
  const lines = content.split("\n")
  const trailing = content.endsWith("\n")
  const body = trailing ? lines.slice(0, -1) : lines
  const header =
    `diff --git a/${file} b/${file}\n` +
    `new file mode 100644\n` +
    `--- /dev/null\n` +
    `+++ b/${file}\n` +
    `@@ -0,0 +1,${body.length} @@\n`
  const hunk = body.map((line) => `+${line}`).join("\n")
  return header + hunk + (trailing ? "\n" : "\n\\ No newline at end of file\n")
}
