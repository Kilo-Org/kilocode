import * as fs from "fs/promises"
import { binaryFile } from "../diff/shared/binary"
import { imageMime, loadImage, readImageFile } from "../diff/shared/image"
import type { DiffBatch } from "../diff/types"
import { resolveInside } from "../diff/shared/path"
import type { GitOps } from "./GitOps"
import { blobs, check, inspect, patches } from "./local-diff-batch"
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

/** Cap per-side reads in the detail view. Opening very large tracked files
 *  used to spike `kilo serve`; now that the detail path runs in the
 *  extension host, the same file would spike VS Code's RSS. Over this
 *  threshold we return a summarized entry (empty `before`/`after`/`patch`,
 *  metadata preserved) so the webview can render counts without
 *  materializing the content. */
export const MAX_DETAIL_BYTES = 20_000_000
const MAX_BATCH_BYTES = 32 * 1024 * 1024

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

export async function resolveBase(git: GitOps, dir: string, base: string, signal?: AbortSignal): Promise<string> {
  // If the caller gave an explicit base, honor it. Return it as-is so merge-base
  // fails loudly on a stale/misspelled ref instead of silently diffing against
  // an unrelated candidate branch.
  if (base && base !== "HEAD") return base
  for (const name of BASE_CANDIDATES) {
    const ok = await git.execGit(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], dir, { signal })
    check(signal)
    if (ok.code === 0) return name
  }
  return "HEAD"
}

async function ancestor(
  git: GitOps,
  dir: string,
  base: string,
  log?: Log,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const resolvedBase = await resolveBase(git, dir, base, signal)
  check(signal)
  const result = await git.execGit(["merge-base", "HEAD", resolvedBase], dir, { signal })
  check(signal)
  if (result.code !== 0) {
    log?.("git merge-base failed", { code: result.code, stderr: result.stderr.trim(), dir, base, resolvedBase })
    return undefined
  }
  return result.stdout.trim()
}

function counts(value: string) {
  const result = new Map<string, { additions: number; deletions: number; binary: boolean }>()
  for (const line of value.trim().split("\n")) {
    if (!line || line.startsWith(":")) continue
    const parts = line.split("\t")
    const add = parts[0]
    const del = parts[1]
    const file = parts.slice(2).join("\t")
    if (!file) continue
    result.set(file, {
      additions: add === "-" ? 0 : parseInt(add || "0", 10) || 0,
      deletions: del === "-" ? 0 : parseInt(del || "0", 10) || 0,
      binary: add === "-" || del === "-",
    })
  }
  return result
}

async function numstat(git: GitOps, dir: string, base: string, file?: string, signal?: AbortSignal) {
  const args = ["-c", "core.quotepath=false", "diff", "--numstat", "--no-renames", base]
  if (file) args.push("--", file)
  const result = await git.execGit(args, dir, { signal })
  check(signal)
  return counts(result.code === 0 ? result.stdout : "")
}

async function statStamp(dir: string, file: string): Promise<string> {
  const full = resolveInside(dir, file)
  if (!full) return `missing:${file}`
  const stat = await fs.lstat(full).catch(() => undefined)
  if (!stat) return `missing:${file}`
  return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino ?? 0}`
}

async function detailReads(git: GitOps, dir: string, anc: string, meta: Meta, signal?: AbortSignal) {
  return Promise.all([
    readBefore(git, dir, anc, meta.file, meta.status, signal),
    readAfter(dir, meta.file, meta.status),
    meta.tracked ? unifiedPatch(git, dir, anc, meta.file, signal) : Promise.resolve(""),
  ])
}

async function sizes(git: GitOps, dir: string, anc: string, meta: Meta, signal?: AbortSignal) {
  return Promise.all([
    meta.status === "added" ? 0 : blobSize(git, dir, anc, meta.file, signal),
    meta.status === "deleted" ? 0 : fileSize(dir, meta.file),
  ])
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

async function list(git: GitOps, dir: string, anc: string, log?: Log): Promise<Meta[]> {
  const [tracked, untracked] = await Promise.all([
    git.execGit(["-c", "core.quotepath=false", "diff", "--raw", "--numstat", "--no-renames", anc], dir),
    git.execGit(["ls-files", "--others", "--exclude-standard"], dir),
  ])
  if (tracked.code !== 0) {
    log?.("git diff --raw --numstat failed", { code: tracked.code, stderr: tracked.stderr.trim() })
    return []
  }

  const result: Meta[] = []
  const seen = new Set<string>()
  const stats = counts(tracked.stdout)

  for (const line of tracked.stdout.trim().split("\n")) {
    if (!line.startsWith(":")) continue
    const parts = line.split("\t")
    const code = parts[0]?.split(" ").at(-1)
    const file = parts.slice(1).join("\t")
    if (!file || !code) continue
    seen.add(file)
    const status = statusFromCode(code)
    const stat = stats.get(file) ?? { additions: 0, deletions: 0, binary: false }
    result.push({
      file,
      additions: stat.additions,
      deletions: stat.deletions,
      status,
      tracked: true,
      generatedLike: generatedLike(file),
      binary: stat.binary,
      stamp:
        status === "deleted" ? `deleted:${anc}` : `${imageMime(file) ? `${anc}:` : ""}${await statStamp(dir, file)}`,
    })
  }

  if (untracked.code !== 0) {
    log?.("git ls-files --others failed", { code: untracked.code, stderr: untracked.stderr.trim() })
    return result
  }

  const files = untracked.stdout.trim()
  if (!files) return result

  for (const file of files.split("\n")) {
    if (!file || seen.has(file)) continue
    const full = resolveInside(dir, file)
    if (!full) continue
    const exists = await fs.lstat(full).catch(() => undefined)
    if (!exists) continue
    const binary = await binaryFile(full)
    result.push({
      file,
      additions: binary ? 0 : await lineCount(full),
      deletions: 0,
      status: "added",
      tracked: false,
      generatedLike: generatedLike(file),
      binary,
      stamp: await statStamp(dir, file),
    })
  }

  return result
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
 * Hot polling path. Returns one summarized entry per changed file (tracked or
 * untracked) relative to `merge-base HEAD base`. No file contents are read —
 * `before`/`after`/`patch` are empty strings. Matches the shape the server's
 * `WorktreeDiff.summary` emits.
 */
export async function diffSummary(git: GitOps, dir: string, base: string, log?: Log): Promise<WorktreeDiffEntry[]> {
  const anc = await ancestor(git, dir, base, log)
  if (!anc) return []
  const items = await list(git, dir, anc, log)
  return items.map(summarize)
}

function complete(
  result: Map<string, WorktreeDiffEntry | null>,
  metas: Meta[],
  before: Map<string, Buffer>,
  diffs: Map<string, string>,
  after: Map<string, string>,
) {
  for (const meta of metas) {
    const value = after.get(meta.file)
    const patch = meta.tracked ? diffs.get(meta.file) : buildUntrackedPatch(meta.file, value ?? "")
    if (value === undefined || patch === undefined || (meta.status !== "added" && !before.has(meta.file))) {
      result.set(meta.file, null)
      continue
    }
    result.set(meta.file, {
      ...summarize(meta),
      before: before.get(meta.file)?.toString("utf8") ?? "",
      after: value,
      patch,
      additions: meta.status === "added" && meta.additions === 0 && !meta.tracked ? linesOf(value) : meta.additions,
      summarized: false,
    })
  }
  return result
}

async function collect(
  git: GitOps,
  dir: string,
  anc: string,
  metas: Meta[],
  log?: Log,
  signal?: AbortSignal,
): Promise<DiffBatch<WorktreeDiffEntry>> {
  const entries = new Map<string, WorktreeDiffEntry | null>()
  const deferred = new Set<string>()
  if (metas.length === 0) return { entries, deferred }
  const [base, sizes] = await Promise.all([
    inspect(git, dir, anc, metas, signal),
    Promise.all(
      metas.map(async (meta) => [meta.file, meta.status === "deleted" ? 0 : await fileSize(dir, meta.file)] as const),
    ),
  ])
  check(signal)
  const working = new Map(sizes)
  const active: Meta[] = []
  let total = 0
  for (const meta of metas) {
    const before = base.get(meta.file)?.bytes ?? 0
    const after = working.get(meta.file) ?? 0
    if (before > MAX_DETAIL_BYTES || after > MAX_DETAIL_BYTES) {
      log?.("diffFile: file too large for detail view, returning summarized entry", {
        file: meta.file,
        beforeBytes: before,
        afterBytes: after,
        cap: MAX_DETAIL_BYTES,
      })
      entries.set(meta.file, summarize(meta))
      continue
    }
    if (total + before + after > MAX_BATCH_BYTES) {
      deferred.add(meta.file)
      continue
    }
    total += before + after
    active.push(meta)
  }
  const [before, diffs, after] = await Promise.all([
    blobs(git, dir, active, base, signal),
    patches(git, dir, anc, active, signal),
    Promise.all(active.map(async (meta) => [meta.file, await readAfter(dir, meta.file, meta.status)] as const)),
  ])
  check(signal)
  return { entries: complete(entries, active, before, diffs, new Map(after)), deferred }
}

export function createLocalDiff(git: GitOps, log?: Log) {
  const states = new Map<string, { anc: string; metas: Map<string, Meta> }>()
  const generations = new Map<string, number>()
  const details = new Map<string, { value: WorktreeDiffEntry; bytes: number; stamp: string }>()
  const pending = new Map<string, { signal?: AbortSignal; work: Promise<WorktreeDiffEntry> }>()
  let bytes = 0

  const forget = (id: string) => {
    const value = details.get(id)
    if (!value) return
    bytes -= value.bytes
    details.delete(id)
  }

  const remember = (id: string, value: WorktreeDiffEntry, stamp: string) => {
    const size = [value.before, value.after, value.patch, value.image?.before?.data, value.image?.after?.data].reduce(
      (sum, value) => sum + Buffer.byteLength(value ?? ""),
      0,
    )
    const current = details.get(id)
    if (current) bytes -= current.bytes
    details.delete(id)
    details.set(id, { value, bytes: size, stamp })
    bytes += size
    while (details.size > 128 || bytes > 64 * 1024 * 1024) {
      const key = details.keys().next().value!
      bytes -= details.get(key)!.bytes
      details.delete(key)
    }
  }

  const identity = (dir: string, base: string, anc: string, meta: Meta) =>
    `${dir}\0${base}\0${anc}\0${meta.file}\0${meta.tracked}\0${meta.status}\0${meta.additions}\0${meta.deletions}\0${meta.binary}\0${meta.stamp}`

  const track = (id: string, meta: Meta, work: Promise<WorktreeDiffEntry>, signal?: AbortSignal) => {
    pending.set(id, { signal, work })
    work.then(
      (value) => {
        if (pending.get(id)?.work !== work) return
        pending.delete(id)
        if (
          signal?.aborted ||
          value.image?.before?.error === "unreadable" ||
          value.image?.after?.error === "unreadable"
        ) {
          return
        }
        remember(id, value, meta.stamp)
      },
      () => {
        if (pending.get(id)?.work === work) pending.delete(id)
      },
    )
    return work
  }

  const file = async (
    dir: string,
    base: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<WorktreeDiffEntry | null> => {
    const state = states.get(`${dir}\0${base}`)
    if (!state) return diffFile(git, dir, base, path, log, signal)
    const meta = state.metas.get(path)
    if (!meta) return null
    const id = identity(dir, base, state.anc, meta)
    const cached = details.get(id)
    if (cached) {
      if (cached.stamp === meta.stamp) {
        remember(id, cached.value, meta.stamp)
        return cached.value
      }
      forget(id)
    }
    const current = pending.get(id)
    if (current && current.signal === signal && !current.signal?.aborted) return current.work
    return track(id, meta, materialize(git, dir, state.anc, meta, log, signal), signal)
  }

  const files = async (
    dir: string,
    base: string,
    paths: readonly string[],
    signal?: AbortSignal,
  ): Promise<DiffBatch<WorktreeDiffEntry>> => {
    const result = new Map<string, WorktreeDiffEntry | null>()
    const deferred = new Set<string>()
    const key = `${dir}\0${base}`
    const state = states.get(key)
    if (!state) {
      check(signal)
      await Promise.all(paths.map(async (path) => result.set(path, await file(dir, base, path, signal))))
      check(signal)
      return { entries: result, deferred }
    }
    const waiting: Promise<void>[] = []
    const fresh: Array<{ id: string; meta: Meta }> = []
    const add = (path: string, work: Promise<WorktreeDiffEntry | null>) => {
      waiting.push(
        work.then(
          (value) => void result.set(path, value),
          () => {
            check(signal)
            if (!deferred.has(path)) result.set(path, null)
          },
        ),
      )
    }
    for (const path of new Set(paths)) {
      const meta = state.metas.get(path)
      if (!meta) {
        result.set(path, null)
        continue
      }
      const id = identity(dir, base, state.anc, meta)
      const cached = details.get(id)
      if (cached?.stamp === meta.stamp) {
        remember(id, cached.value, meta.stamp)
        result.set(path, cached.value)
        continue
      }
      const current = pending.get(id)
      if (current && current.signal === signal && !current.signal?.aborted) {
        add(path, current.work)
        continue
      }
      if (meta.binary || imageMime(path) || /[\r\n\t"\\]/.test(path)) {
        add(path, file(dir, base, path, signal))
        continue
      }
      fresh.push({ id, meta })
    }
    if (fresh.length > 0) {
      const batch = collect(
        git,
        dir,
        state.anc,
        fresh.map((item) => item.meta),
        log,
        signal,
      )
        .then((values) => {
          const current = states.get(key)
          if (
            !current ||
            current.anc !== state.anc ||
            fresh.some((item) => {
              const meta = current.metas.get(item.meta.file)
              return !meta || identity(dir, base, current.anc, meta) !== item.id
            })
          ) {
            throw new Error("Diff summary changed")
          }
          for (const path of values.deferred) deferred.add(path)
          return values
        })
        .catch((err): DiffBatch<WorktreeDiffEntry> => {
          check(signal)
          log?.("Bulk diff detail failed, falling back to single-file requests", err)
          for (const item of fresh) deferred.add(item.meta.file)
          return { entries: new Map(), deferred }
        })
      for (const item of fresh) {
        const work = batch.then((values) => {
          const value = values.entries.get(item.meta.file)
          if (!value) throw new Error(`Could not load diff for ${item.meta.file}`)
          return value
        })
        add(item.meta.file, track(item.id, item.meta, work, signal))
      }
    }
    await Promise.all(waiting)
    check(signal)
    return { entries: result, deferred }
  }

  return {
    summary: async (dir: string, base: string): Promise<WorktreeDiffEntry[]> => {
      const id = `${dir}\0${base}`
      const generation = (generations.get(id) ?? 0) + 1
      generations.set(id, generation)
      const anc = await ancestor(git, dir, base, log)
      if (!anc) {
        if (generations.get(id) === generation) states.delete(id)
        return []
      }

      const items = await list(git, dir, anc, log)
      if (generations.get(id) !== generation) return items.map(summarize)
      states.delete(id)
      states.set(id, { anc, metas: new Map(items.map((item) => [item.file, item])) })
      if (states.size > 8) states.delete(states.keys().next().value!)
      return items.map(summarize)
    },
    file,
    files,
  }
}

async function detailMeta(
  git: GitOps,
  dir: string,
  anc: string,
  file: string,
  signal?: AbortSignal,
): Promise<Meta | undefined> {
  const full = resolveInside(dir, file)
  if (!full) return undefined
  const tracked = await git.execGit(["ls-files", "--error-unmatch", "--", file], dir, { signal })
  check(signal)
  if (tracked.code !== 0) {
    const untracked = await git.execGit(["ls-files", "--others", "--exclude-standard", "--", file], dir, { signal })
    check(signal)
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
    { signal },
  )
  check(signal)
  if (nameStatus.code !== 0) return undefined
  const line = nameStatus.stdout.trim().split("\n")[0]
  if (!line) return undefined
  const parts = line.split("\t")
  const code = parts[0]
  const pathPart = parts.slice(1).join("\t") || file
  if (!code) return undefined

  const counts = await numstat(git, dir, anc, file, signal)
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
    stamp:
      status === "deleted"
        ? `deleted:${anc}`
        : `${imageMime(pathPart) ? `${anc}:` : ""}${await statStamp(dir, pathPart)}`,
  }
}

async function blobSize(git: GitOps, dir: string, anc: string, file: string, signal?: AbortSignal): Promise<number> {
  const result = await git.execGit(["cat-file", "-s", `${anc}:${file}`], dir, { signal })
  if (result.code !== 0) throw new Error(`Could not read base blob for ${file}`)
  return parseInt(result.stdout.trim(), 10) || 0
}

async function fileSize(dir: string, file: string): Promise<number> {
  const full = resolveInside(dir, file)
  if (!full) return 0
  const stat = await fs.lstat(full).catch(() => undefined)
  return stat?.size ?? 0
}

async function readBlob(
  git: GitOps,
  dir: string,
  ref: string,
  file: string,
  signal?: AbortSignal,
): Promise<Buffer | undefined> {
  const result = await git.execGitBuffer(["show", `${ref}:${file}`], dir, { signal })
  return result.code === 0 ? result.stdout : undefined
}

async function readFile(dir: string, file: string): Promise<Buffer | undefined> {
  const full = resolveInside(dir, file)
  if (!full) return undefined
  const stat = await fs.lstat(full).catch(() => undefined)
  if (!stat?.isFile()) return undefined
  return readImageFile(full)
}

async function readBefore(
  git: GitOps,
  dir: string,
  anc: string,
  file: string,
  status: Status,
  signal?: AbortSignal,
): Promise<string> {
  if (status === "added") return ""
  const result = await git.execGit(["show", `${anc}:${file}`], dir, { signal })
  if (result.code !== 0) throw new Error(`Could not read base file for ${file}`)
  return result.stdout
}

async function readAfter(dir: string, file: string, status: Status): Promise<string> {
  if (status === "deleted") return ""
  const full = resolveInside(dir, file)
  if (!full) throw new Error(`Could not resolve working file for ${file}`)
  const stat = await fs.lstat(full).catch(() => undefined)
  if (!stat) throw new Error(`Could not read working file for ${file}`)
  if (stat.isSymbolicLink()) return fs.readlink(full).catch(() => "")
  if (!stat.isFile()) throw new Error(`Working path is not a file: ${file}`)
  return fs.readFile(full, "utf-8").catch(() => {
    throw new Error(`Could not read working file for ${file}`)
  })
}

async function unifiedPatch(
  git: GitOps,
  dir: string,
  anc: string,
  file: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await git.execGit(
    ["-c", "core.quotepath=false", "diff", "--no-ext-diff", "--no-renames", anc, "--", file],
    dir,
    { signal },
  )
  if (result.code !== 0) throw new Error(`Could not create diff for ${file}`)
  return result.stdout
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
  signal?: AbortSignal,
): Promise<WorktreeDiffEntry | null> {
  check(signal)
  const anc = await ancestor(git, dir, base, log, signal)
  if (!anc) return null
  const meta = await detailMeta(git, dir, anc, file, signal)
  check(signal)
  if (!meta) return null
  return materialize(git, dir, anc, meta, log, signal)
}

async function materialize(
  git: GitOps,
  dir: string,
  anc: string,
  meta: Meta,
  log?: Log,
  signal?: AbortSignal,
): Promise<WorktreeDiffEntry> {
  const mime = imageMime(meta.file)
  if (meta.binary && !mime) return summarize(meta)
  const [beforeBytes, afterBytes] = await sizes(git, dir, anc, meta, signal)
  if (signal?.aborted) throw new Error("Diff detail aborted")
  if (mime) {
    const image = await loadImage(
      meta.file,
      meta.status === "added"
        ? undefined
        : { bytes: beforeBytes, read: () => readBlob(git, dir, anc, meta.file, signal) },
      meta.status === "deleted" ? undefined : { bytes: afterBytes, read: () => readFile(dir, meta.file) },
    )
    if (signal?.aborted) throw new Error("Diff detail aborted")
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

  const [before, after, tracked] = await detailReads(git, dir, anc, meta, signal)
  if (signal?.aborted) throw new Error("Diff detail aborted")
  const patch = meta.tracked ? tracked : buildUntrackedPatch(meta.file, after)
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
