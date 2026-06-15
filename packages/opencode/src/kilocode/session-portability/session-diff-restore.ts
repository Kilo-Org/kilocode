import fs from "node:fs"
import os from "node:os"
import path from "node:path"

type Diff = {
  file?: string
  patch?: string
  after?: string
  additions?: number
  deletions?: number
  status?: string
}

export type RestoreResult = {
  applied: number
  skipped: number
  total: number
}

function diffs(value: unknown): Diff[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Diff => typeof item === "object" && item !== null)
}

export function extractSessionDiffs(data: unknown): Diff[] {
  if (typeof data !== "object" || data === null) return []
  const root = data as { sessionDiff?: unknown; session_diff?: unknown; messages?: unknown }
  const top = diffs(root.sessionDiff).length > 0 ? diffs(root.sessionDiff) : diffs(root.session_diff)
  if (top.length > 0) return top
  if (!Array.isArray(root.messages)) return []

  const map = new Map<string, Diff>()
  for (const msg of root.messages) {
    if (typeof msg !== "object" || msg === null) continue
    const info = (msg as { info?: unknown }).info
    if (typeof info !== "object" || info === null) continue
    const summary = (info as { summary?: unknown }).summary
    if (typeof summary !== "object" || summary === null) continue
    for (const diff of diffs((summary as { diffs?: unknown }).diffs)) {
      if (typeof diff.file === "string") map.set(diff.file, diff)
    }
  }
  return Array.from(map.values())
}

function safe(root: string, file: string) {
  const fp = path.resolve(root, file)
  const rel = path.relative(root, fp)
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return
  return fp
}

function apply(dir: string, diff: Diff) {
  if (!diff.patch) return false
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-session-diff-"))
  const file = path.join(tmp, "change.patch")
  try {
    const text = diff.patch.endsWith("\n") ? diff.patch : diff.patch + "\n"
    fs.writeFileSync(file, text)
    const proc = Bun.spawnSync(["git", "apply", "--3way", "--whitespace=nowarn", file], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    })
    return proc.exitCode === 0
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

export function restoreSessionDiffs(input: { directory: string; diffs: Diff[] }): RestoreResult {
  const root = path.resolve(input.directory)
  const total = input.diffs.length
  const result = { applied: 0, skipped: 0, total }

  for (const diff of input.diffs) {
    if (diff.patch) {
      if (apply(root, diff)) {
        result.applied++
        continue
      }
      result.skipped++
      continue
    }

    if (typeof diff.file !== "string") {
      result.skipped++
      continue
    }
    const fp = safe(root, diff.file)
    if (!fp) {
      result.skipped++
      continue
    }

    if (diff.status === "deleted") {
      fs.rmSync(fp, { force: true })
      result.applied++
      continue
    }

    if (typeof diff.after !== "string" || diff.after.length === 0) {
      result.skipped++
      continue
    }
    fs.mkdirSync(path.dirname(fp), { recursive: true })
    fs.writeFileSync(fp, diff.after)
    result.applied++
  }

  return result
}
