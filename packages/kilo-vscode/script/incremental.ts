import type { OutputFile } from "esbuild"
import { randomUUID } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent,
} from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"

// Compact tuple `[size, mtimeMs, ctimeMs, ino]` keeps per-target build state small and fast to read/write.
type FileStamp = readonly [number, number, number, number]
type OutputStamp = readonly [number, number, number, number, string?]

export type TargetState = {
  version: 1
  inputs: Record<string, FileStamp>
  directories?: Record<string, string[]>
  outputs: Record<string, OutputStamp>
}

function statFile(filePath: string): FileStamp | undefined {
  try {
    const info = statSync(filePath)
    if (!info.isFile()) return undefined
    return [info.size, info.mtimeMs, info.ctimeMs, info.ino]
  } catch {
    return undefined
  }
}

function sameStamp(a: FileStamp | OutputStamp | undefined, b: FileStamp | OutputStamp | undefined) {
  if (!a || !b) return false
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
}

function hashBytes(bytes: Uint8Array) {
  return Bun.hash(bytes).toString(16)
}

export function hasStateDir(stateDir: string) {
  return existsSync(path.join(stateDir, "ready"))
}

export function markStateDirReady(stateDir: string) {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(path.join(stateDir, "ready"), "1")
}

export function readTargetState(stateDir: string, name: string): TargetState | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path.join(stateDir, `${name}.json`), "utf8")) as Partial<TargetState>
    if (parsed.version !== 1 || !parsed.inputs || !parsed.outputs) return undefined
    return parsed as TargetState
  } catch {
    return undefined
  }
}

export function writeTargetState(stateDir: string, name: string, state: TargetState) {
  mkdirSync(stateDir, { recursive: true })
  const target = path.join(stateDir, `${name}.json`)
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, JSON.stringify(state))
    renameSync(temp, target)
  } catch {
    rmSync(temp, { force: true })
  }
}

export function isTargetFresh(target: TargetState | undefined, dist: string) {
  if (!target) return false
  if (target.directories) {
    for (const [dir, expected] of Object.entries(target.directories)) {
      const actual = listDir(dir)
      if (!actual || actual.length !== expected.length || actual.some((name, index) => name !== expected[index]))
        return false
    }
  }
  for (const [file, expected] of Object.entries(target.inputs)) {
    if (!sameStamp(statFile(file), expected)) return false
  }
  for (const [rel, expected] of Object.entries(target.outputs)) {
    if (!sameStamp(statFile(path.join(dist, rel)), expected)) return false
  }
  return true
}

// Record workspace files before node_modules files so `isTargetFresh` fails fast on any local source edit.
export function stampFiles(files: readonly string[]): Record<string, FileStamp> {
  const ordered = [
    ...files.filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`)),
    ...files.filter((file) => file.includes(`${path.sep}node_modules${path.sep}`)),
  ]
  const stamps: Record<string, FileStamp> = {}
  for (const file of ordered) {
    const stamp = statFile(file)
    if (stamp) stamps[file] = stamp
  }
  return stamps
}

export function stampOutputs(dist: string, relPaths: readonly string[]): Record<string, OutputStamp> {
  const stamps: Record<string, OutputStamp> = {}
  for (const rel of relPaths) {
    const stamp = statFile(path.join(dist, rel))
    if (stamp) stamps[rel] = stamp
  }
  return stamps
}

export function snapshotDirectories(dirs: readonly string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const dir of dirs) result[dir] = listDir(dir) ?? []
  return result
}

export function listDirFiles(dirs: readonly string[]): string[] {
  return dirs.flatMap((dir) => (listDir(dir) ?? []).map((name) => path.join(dir, name)))
}

export function collectRelativeFiles(rootDir: string, prefix = ""): string[] {
  const results: string[] = []
  let entries: Dirent[]
  try {
    entries = readdirSync(rootDir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    const full = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectRelativeFiles(full, rel))
      continue
    }
    if (entry.isFile()) results.push(rel)
  }
  return results
}

// Writes only output files whose bytes changed since the previous build and deletes any stale files that the
// previous build of this target produced. The resulting dist/ tree is byte-for-byte identical to a clean write.
export async function syncOutputFiles(
  dist: string,
  previous: Record<string, OutputStamp> | undefined,
  files: readonly OutputFile[],
): Promise<Record<string, OutputStamp>> {
  const next: Record<string, OutputStamp> = {}
  const keep = new Set<string>()
  const writes: Promise<void>[] = []

  for (const file of files) {
    const rel = path.relative(dist, file.path).split(path.sep).join("/")
    keep.add(rel)
    const hash = hashBytes(file.contents)
    const prev = previous?.[rel]
    if (prev?.[4] === hash && sameStamp(statFile(file.path), prev)) {
      next[rel] = prev
      continue
    }
    writes.push(
      mkdir(path.dirname(file.path), { recursive: true }).then(async () => {
        await writeFile(file.path, file.contents)
        const stamp = statFile(file.path)
        if (stamp) next[rel] = [stamp[0], stamp[1], stamp[2], stamp[3], hash]
      }),
    )
  }

  const removals = Object.keys(previous ?? {})
    .filter((rel) => !keep.has(rel))
    .map((rel) => rm(path.join(dist, rel), { force: true }))

  await Promise.all([...writes, ...removals])
  return next
}

function listDir(dir: string) {
  try {
    return readdirSync(dir).toSorted()
  } catch {
    return undefined
  }
}
