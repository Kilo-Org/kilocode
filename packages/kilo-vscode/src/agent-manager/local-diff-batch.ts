import type { GitOps } from "./GitOps"

type Entry = { file: string; status: string; tracked: boolean }
type Base = { id: string; bytes: number }

export function check(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Diff detail aborted")
}

export async function inspect(git: GitOps, dir: string, anc: string, metas: Entry[], signal?: AbortSignal) {
  const items = metas.filter((meta) => meta.status !== "added")
  const result = new Map<string, Base>()
  if (items.length === 0) return result
  const stdin = items.map((meta) => `${anc}:${meta.file}\n`).join("")
  const output = await git.execGit(["cat-file", "--batch-check"], dir, { stdin, signal })
  check(signal)
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

export async function blobs(git: GitOps, dir: string, metas: Entry[], base: Map<string, Base>, signal?: AbortSignal) {
  const items = metas.filter((meta) => meta.status !== "added")
  const result = new Map<string, Buffer>()
  if (items.length === 0) return result
  const stdin = items.map((meta) => `${base.get(meta.file)!.id}\n`).join("")
  const output = await git.execGitBuffer(["cat-file", "--batch"], dir, { stdin, signal })
  check(signal)
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

export async function patches(git: GitOps, dir: string, anc: string, metas: Entry[], signal?: AbortSignal) {
  const items = metas.filter((meta) => meta.tracked)
  const result = new Map<string, string>()
  if (items.length === 0) return result
  const output = await git.execGit(
    [
      "-c",
      "core.quotepath=false",
      "diff",
      "--no-ext-diff",
      "--no-renames",
      anc,
      "--",
      ...items.map((meta) => meta.file),
    ],
    dir,
    { signal },
  )
  check(signal)
  if (output.code !== 0) throw new Error("Could not create file diffs")
  for (const patch of output.stdout.split(/(?=^diff --git )/m)) {
    if (!patch) continue
    const line = patch.slice(0, patch.indexOf("\n"))
    const meta = items.find((item) => line === `diff --git a/${item.file} b/${item.file}`)
    if (!meta) throw new Error("Could not match a file diff")
    result.set(meta.file, patch)
  }
  return result
}
