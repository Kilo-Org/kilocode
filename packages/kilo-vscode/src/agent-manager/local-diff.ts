import * as fs from "fs/promises"
import { imageMime, loadImage, readImageFile } from "../diff/shared/image"
import { resolveInside } from "../diff/shared/path"
import type { GitOps } from "./GitOps"
import { measure } from "./git-stats-snapshot"
import { check, collect, fileSize, MAX_DETAIL_BYTES, readAfter, summarize, type Meta } from "./local-diff-batch"
import { createDiffCache } from "./local-diff-cache"
import type { WorktreeDiffEntry } from "./types"

type Status = Meta["status"]

type Log = (...args: unknown[]) => void

/** Cap per-side reads in the detail view. Opening very large tracked files
 *  used to spike `kilo serve`; now that the detail path runs in the
 *  extension host, the same file would spike VS Code's RSS. Over this
 *  threshold we return a summarized entry (empty `before`/`after`/`patch`,
 *  metadata preserved) so the webview can render counts without
 *  materializing the content. */
export { MAX_DETAIL_BYTES } from "./local-diff-batch"
const MAX_SUMMARY_FILES = 32

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
    const ok = await git.execGit(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], dir, {
      signal,
      priority: true,
    })
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
  const result = await git.execGit(["merge-base", "HEAD", resolvedBase], dir, { signal, priority: true })
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
  const result = await git.execGit(args, dir, { signal, priority: true })
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

function statusFromCode(code: string): Status {
  if (code === "A") return "added"
  if (code === "D") return "deleted"
  return "modified"
}

async function list(git: GitOps, dir: string, anc: string, log?: Log): Promise<Meta[]> {
  const [tracked, untracked] = await Promise.all([
    git.execGit(["-c", "core.quotepath=false", "diff", "--raw", "--numstat", "--no-renames", anc], dir, {
      priority: true,
    }),
    git.execGit(["ls-files", "--others", "--exclude-standard"], dir, { priority: true }),
  ])
  if (tracked.code !== 0) {
    log?.("git diff --raw --numstat failed", { code: tracked.code, stderr: tracked.stderr.trim() })
    return []
  }

  const result: Meta[] = []
  const seen = new Set<string>()
  const stats = counts(tracked.stdout)
  const lines = tracked.stdout
    .trim()
    .split("\n")
    .filter((line) => line.startsWith(":"))

  for (let index = 0; index < lines.length; index += MAX_SUMMARY_FILES) {
    const entries = await Promise.all(
      lines.slice(index, index + MAX_SUMMARY_FILES).map(async (line): Promise<Meta | undefined> => {
        const parts = line.split("\t")
        const code = parts[0]?.split(" ").at(-1)
        const file = parts.slice(1).join("\t")
        if (!file || !code) return undefined
        seen.add(file)
        const status = statusFromCode(code)
        const stat = stats.get(file) ?? { additions: 0, deletions: 0, binary: false }
        return {
          file,
          additions: stat.additions,
          deletions: stat.deletions,
          status,
          tracked: true,
          generatedLike: generatedLike(file),
          binary: stat.binary,
          stamp:
            status === "deleted"
              ? `deleted:${anc}`
              : `${imageMime(file) ? `${anc}:` : ""}${await statStamp(dir, file)}`,
        }
      }),
    )
    for (const entry of entries) {
      if (entry) result.push(entry)
    }
  }

  if (untracked.code !== 0) {
    log?.("git ls-files --others failed", { code: untracked.code, stderr: untracked.stderr.trim() })
    return result
  }

  const files = untracked.stdout.trim()
  if (!files) return result
  const paths = files.split("\n").filter((file) => file && !seen.has(file))

  for (let index = 0; index < paths.length; index += MAX_SUMMARY_FILES) {
    const entries = await Promise.all(
      paths.slice(index, index + MAX_SUMMARY_FILES).map(async (file): Promise<Meta | undefined> => {
        const full = resolveInside(dir, file)
        if (!full) return undefined
        const value = await measure(full)
        if (!value) return undefined
        return {
          file,
          additions: value.count,
          deletions: 0,
          status: "added",
          tracked: false,
          generatedLike: generatedLike(file),
          binary: value.binary,
          stamp: value.stamp,
        }
      }),
    )
    for (const entry of entries) {
      if (entry) result.push(entry)
    }
  }

  return result
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

export function createLocalDiff(git: GitOps, log?: Log) {
  return createDiffCache({
    summary: async (dir, base) => {
      const anc = await ancestor(git, dir, base, log)
      if (!anc) return undefined
      const metas = await list(git, dir, anc, log)
      return { anc, metas, entries: metas.map(summarize) }
    },
    file: (dir, base, path, signal) => diffFile(git, dir, base, path, log, signal),
    detail: (dir, anc, meta, signal) => materialize(git, dir, anc, meta, log, signal),
    batch: (dir, anc, metas) => collect(git, dir, anc, metas, log),
    log,
  })
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
  const tracked = await git.execGit(["ls-files", "--error-unmatch", "--", file], dir, { signal, priority: true })
  check(signal)
  if (tracked.code !== 0) {
    const untracked = await git.execGit(["ls-files", "--others", "--exclude-standard", "--", file], dir, {
      signal,
      priority: true,
    })
    check(signal)
    if (untracked.code !== 0 || !untracked.stdout.split("\n").includes(file)) return undefined
    const value = await measure(full)
    if (!value) return undefined
    return {
      file,
      additions: value.count,
      deletions: 0,
      status: "added",
      tracked: false,
      generatedLike: generatedLike(file),
      binary: value.binary,
      stamp: value.stamp,
    }
  }

  const nameStatus = await git.execGit(
    ["-c", "core.quotepath=false", "diff", "--name-status", "--no-renames", anc, "--", file],
    dir,
    { signal, priority: true },
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
  const result = await git.execGit(["cat-file", "-s", `${anc}:${file}`], dir, { signal, priority: true })
  if (result.code !== 0) throw new Error(`Could not read base blob for ${file}`)
  return parseInt(result.stdout.trim(), 10) || 0
}

async function readBlob(
  git: GitOps,
  dir: string,
  ref: string,
  file: string,
  signal?: AbortSignal,
): Promise<Buffer | undefined> {
  const result = await git.execGitBuffer(["show", `${ref}:${file}`], dir, { signal, priority: true })
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
  const result = await git.execGit(["show", `${anc}:${file}`], dir, { signal, priority: true })
  if (result.code !== 0) throw new Error(`Could not read base file for ${file}`)
  return result.stdout
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
    { signal, priority: true },
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
