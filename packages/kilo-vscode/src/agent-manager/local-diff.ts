import * as fs from "fs/promises"
import * as path from "path"
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
  const result = await git.execGit(["merge-base", "HEAD", resolvedBase], dir)
  if (result.code !== 0) {
    log?.("git merge-base failed", { code: result.code, stderr: result.stderr.trim(), dir, base, resolvedBase })
    return undefined
  }
  return result.stdout.trim()
}

async function numstat(git: GitOps, dir: string, base: string, file?: string) {
  const args = ["-c", "core.quotepath=false", "diff", "--numstat", "--no-renames", base]
  if (file) args.push("--", file)
  const result = await git.execGit(args, dir)
  const map = new Map<string, { additions: number; deletions: number }>()
  if (result.code !== 0) return map
  for (const line of result.stdout.trim().split("\n")) {
    if (!line) continue
    const parts = line.split("\t")
    const add = parts[0]
    const del = parts[1]
    const name = parts.slice(2).join("\t")
    if (!name) continue
    map.set(name, {
      additions: add === "-" ? 0 : parseInt(add || "0", 10) || 0,
      deletions: del === "-" ? 0 : parseInt(del || "0", 10) || 0,
    })
  }
  return map
}

async function statStamp(dir: string, file: string): Promise<string> {
  const stat = await fs.stat(path.join(dir, file)).catch(() => undefined)
  if (!stat) return `missing:${file}`
  return `${stat.size}:${stat.mtimeMs}`
}

async function lineCount(file: string): Promise<number> {
  const stat = await fs.stat(file).catch(() => undefined)
  if (!stat || stat.size === 0) return 0
  if (stat.size > MAX_UNTRACKED_BYTES) return 0
  const content = await fs.readFile(file, "utf-8").catch(() => "")
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
  const nameStatus = await git.execGit(
    ["-c", "core.quotepath=false", "diff", "--name-status", "--no-renames", anc],
    dir,
  )
  if (nameStatus.code !== 0) {
    log?.("git diff --name-status failed", { code: nameStatus.code, stderr: nameStatus.stderr.trim() })
    return []
  }

  const counts = await numstat(git, dir, anc)
  const result: Meta[] = []
  const seen = new Set<string>()

  for (const line of nameStatus.stdout.trim().split("\n")) {
    if (!line) continue
    const parts = line.split("\t")
    const code = parts[0]
    const file = parts.slice(1).join("\t")
    if (!file || !code) continue
    seen.add(file)
    const status = statusFromCode(code)
    const stat = counts.get(file) ?? { additions: 0, deletions: 0 }
    result.push({
      file,
      additions: stat.additions,
      deletions: stat.deletions,
      status,
      tracked: true,
      generatedLike: generatedLike(file),
      stamp: status === "deleted" ? `deleted:${anc}` : await statStamp(dir, file),
    })
  }

  const untracked = await git.execGit(["ls-files", "--others", "--exclude-standard"], dir)
  if (untracked.code !== 0) {
    log?.("git ls-files --others failed", { code: untracked.code, stderr: untracked.stderr.trim() })
    return result
  }

  const files = untracked.stdout.trim()
  if (!files) return result

  for (const file of files.split("\n")) {
    if (!file || seen.has(file)) continue
    const full = path.join(dir, file)
    const exists = await fs.stat(full).catch(() => undefined)
    if (!exists) continue
    result.push({
      file,
      additions: await lineCount(full),
      deletions: 0,
      status: "added",
      tracked: false,
      generatedLike: generatedLike(file),
      stamp: await statStamp(dir, file),
    })
  }

  return result
}

function summarize(meta: Meta): WorktreeDiffEntry {
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
    summarized: true,
    stamp: meta.stamp,
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

async function detailMeta(git: GitOps, dir: string, anc: string, file: string): Promise<Meta | undefined> {
  const tracked = await git.execGit(["ls-files", "--error-unmatch", "--", file], dir)
  if (tracked.code !== 0) {
    const full = path.join(dir, file)
    const exists = await fs.stat(full).catch(() => undefined)
    if (!exists) return undefined
    return {
      file,
      additions: await lineCount(full),
      deletions: 0,
      status: "added",
      tracked: false,
      generatedLike: generatedLike(file),
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
  const stat = counts.get(file) ?? counts.get(pathPart) ?? { additions: 0, deletions: 0 }
  const status = statusFromCode(code)
  return {
    file: pathPart,
    additions: stat.additions,
    deletions: stat.deletions,
    status,
    tracked: true,
    generatedLike: generatedLike(pathPart),
    stamp: status === "deleted" ? `deleted:${anc}` : await statStamp(dir, pathPart),
  }
}

async function blobSize(git: GitOps, dir: string, anc: string, file: string): Promise<number> {
  const result = await git.execGit(["cat-file", "-s", `${anc}:${file}`], dir)
  if (result.code !== 0) return 0
  return parseInt(result.stdout.trim(), 10) || 0
}

async function fileSize(dir: string, file: string): Promise<number> {
  const stat = await fs.stat(path.join(dir, file)).catch(() => undefined)
  return stat?.size ?? 0
}

async function readBefore(git: GitOps, dir: string, anc: string, file: string, status: Status): Promise<string> {
  if (status === "added") return ""
  const result = await git.execGit(["show", `${anc}:${file}`], dir)
  return result.code === 0 ? result.stdout : ""
}

async function readAfter(dir: string, file: string, status: Status): Promise<string> {
  if (status === "deleted") return ""
  const full = path.join(dir, file)
  const exists = await fs.stat(full).catch(() => undefined)
  if (!exists) return ""
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

  // Cheap size probe before materializing content — protects the extension
  // host from OOM on huge tracked files. `git cat-file -s` returns the blob
  // size without streaming its contents, and `fs.stat` is a plain syscall.
  const beforeBytes = meta.status === "added" ? 0 : await blobSize(git, dir, anc, meta.file)
  const afterBytes = meta.status === "deleted" ? 0 : await fileSize(dir, meta.file)
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
