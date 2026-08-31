import * as fs from "fs/promises"
import { imageMime } from "../diff/shared/image"
import { resolveInside } from "../diff/shared/path"
import type { GitOps } from "./GitOps"
import type { WorktreeDiffEntry } from "./types"

export type Meta = {
  file: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"
  tracked: boolean
  generatedLike: boolean
  binary: boolean
  stamp: string
}

export type Batch = {
  entries: Map<string, WorktreeDiffEntry | null>
  deferred: Set<string>
}

type Base = { id: string; bytes: number }

export const MAX_DETAIL_BYTES = 20_000_000
const MAX_BATCH_BYTES = 32 * 1024 * 1024

export function check(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Diff detail aborted")
}

export function summarize(meta: Meta): WorktreeDiffEntry {
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

export async function fileSize(dir: string, file: string): Promise<number> {
  const full = resolveInside(dir, file)
  if (!full) return 0
  const stat = await fs.lstat(full).catch(() => undefined)
  return stat?.size ?? 0
}

export async function readAfter(dir: string, file: string, status: Meta["status"]): Promise<string> {
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

async function inspect(git: GitOps, dir: string, anc: string, metas: Meta[]) {
  const items = metas.filter((meta) => meta.status !== "added")
  const result = new Map<string, Base>()
  if (items.length === 0) return result
  const stdin = items.map((meta) => `${anc}:${meta.file}\n`).join("")
  const output = await git.execGit(["cat-file", "--batch-check"], dir, { stdin, priority: true })
  if (output.code !== 0) throw new Error("Could not inspect base files")
  const lines = output.stdout.trimEnd().split("\n")
  if (lines.length !== items.length) throw new Error("Incomplete base file metadata")
  for (const [index, meta] of items.entries()) {
    const [id, type, value] = lines[index]!.split(" ")
    const bytes = Number(value)
    if (!id || type !== "blob" || !Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error(`Could not inspect base file for ${meta.file}`)
    }
    result.set(meta.file, { id, bytes })
  }
  return result
}

async function blobs(git: GitOps, dir: string, metas: Meta[], base: Map<string, Base>) {
  const items = metas.filter((meta) => meta.status !== "added")
  const result = new Map<string, Buffer>()
  if (items.length === 0) return result
  const stdin = items.map((meta) => `${base.get(meta.file)!.id}\n`).join("")
  const output = await git.execGitBuffer(["cat-file", "--batch"], dir, { stdin, priority: true })
  if (output.code !== 0) throw new Error("Could not read base files")
  let offset = 0
  for (const meta of items) {
    const end = output.stdout.indexOf(10, offset)
    if (end === -1) throw new Error(`Incomplete base file for ${meta.file}`)
    const [id, type, value] = output.stdout.subarray(offset, end).toString("utf8").split(" ")
    const size = Number(value)
    const expected = base.get(meta.file)!
    const next = end + 1 + size
    if (id !== expected.id || type !== "blob" || size !== expected.bytes || output.stdout[next] !== 10) {
      throw new Error(`Invalid base file for ${meta.file}`)
    }
    result.set(meta.file, output.stdout.subarray(end + 1, next))
    offset = next + 1
  }
  return result
}

async function patches(git: GitOps, dir: string, anc: string, metas: Meta[]) {
  const result = new Map<string, string>()
  if (metas.length === 0) return result
  const output = await git.execGit(
    [
      "-c",
      "core.quotepath=false",
      "diff",
      "--no-ext-diff",
      "--no-renames",
      anc,
      "--",
      ...metas.map((meta) => meta.file),
    ],
    dir,
    { priority: true },
  )
  if (output.code !== 0) throw new Error("Could not create file diffs")
  const names = new Map(metas.map((meta) => [`diff --git a/${meta.file} b/${meta.file}`, meta.file]))
  for (const patch of output.stdout.split(/(?=^diff --git )/m)) {
    if (!patch) continue
    const file = names.get(patch.slice(0, patch.indexOf("\n")))
    if (!file) throw new Error("Could not match a file diff")
    result.set(file, patch)
  }
  return result
}

export async function collect(
  git: GitOps,
  dir: string,
  anc: string,
  metas: Meta[],
  log?: (...args: unknown[]) => void,
): Promise<Batch> {
  const entries = new Map<string, WorktreeDiffEntry | null>()
  const deferred = new Set<string>()
  if (metas.length === 0) return { entries, deferred }
  const [base, sizes] = await Promise.all([
    inspect(git, dir, anc, metas),
    Promise.all(
      metas.map(async (meta) => [meta.file, meta.status === "deleted" ? 0 : await fileSize(dir, meta.file)] as const),
    ),
  ])
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
    blobs(git, dir, active, base),
    patches(git, dir, anc, active),
    Promise.all(active.map(async (meta) => [meta.file, await readAfter(dir, meta.file, meta.status)] as const)),
  ])
  const values = new Map(after)
  for (const meta of active) {
    const value = values.get(meta.file)
    const patch = diffs.get(meta.file)
    if (value === undefined || patch === undefined || (meta.status !== "added" && !before.has(meta.file))) {
      entries.set(meta.file, null)
      continue
    }
    entries.set(meta.file, {
      ...summarize(meta),
      before: before.get(meta.file)?.toString("utf8") ?? "",
      after: value,
      patch,
      summarized: false,
    })
  }
  return { entries, deferred }
}
