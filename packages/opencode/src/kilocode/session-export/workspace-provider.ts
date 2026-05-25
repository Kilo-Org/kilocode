import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { formatPatch, structuredPatch } from "diff"
import { Config } from "./config"
import type { DeltaEntry, FileEntry } from "./events"
import { isHighRiskPath } from "./worker/scrub"

type File = {
  path: string
  kind: "file" | "symlink"
  size: number
  hash: string
  content?: string
  omitted?: FileEntry["omitted"]
}

export function createWorkspaceProvider(opts: { root: string; statePath?: string }) {
  const state = load(opts.statePath)
  const snapshots = new Map<string, Map<string, File>>(
    Object.entries(state.snapshots).map(([key, files]) => [key, new Map(files.map((file) => [file.path, file]))]),
  )

  const capture = async () => {
    const files = await scan(opts.root)
    const id = hash(files)
    snapshots.set(id, files)
    state.snapshots[id] = [...files.values()]
    save(opts.statePath, state)
    return { id, files }
  }

  return {
    current(sessionId: string): string | undefined {
      return state.sessions[sessionId]
    },
    remember(sessionId: string, snapshotId: string): void {
      state.sessions[sessionId] = snapshotId
      save(opts.statePath, state)
    },
    async baseline(): Promise<{ snapshotId: string; files: FileEntry[] }> {
      const snap = await capture()
      return { snapshotId: snap.id, files: [...snap.files.values()].map(entry) }
    },
    async diff(prevSnapshotHash: string): Promise<{ snapshotHash: string; diff: DeltaEntry[] }> {
      const snap = await capture()
      const prev = snapshots.get(prevSnapshotHash) ?? new Map()
      return { snapshotHash: snap.id, diff: delta(prev, snap.files) }
    },
  }
}

type State = {
  sessions: Record<string, string>
  snapshots: Record<string, File[]>
}

function load(file: string | undefined): State {
  if (!file || !existsSync(file)) return { sessions: {}, snapshots: {} }
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as Partial<State>
    return { sessions: value.sessions ?? {}, snapshots: value.snapshots ?? {} }
  } catch {
    return { sessions: {}, snapshots: {} }
  }
}

function save(file: string | undefined, state: State): void {
  if (!file) return
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(state))
}

async function scan(root: string): Promise<Map<string, File>> {
  const paths = await list(root)
  const files = await Promise.all(paths.map((item) => inspect(root, item)))
  const out = new Map<string, File>()
  for (const file of files.filter((item): item is File => Boolean(item))) out.set(file.path, file)
  return out
}

async function list(root: string): Promise<string[]> {
  const git = await isgit(root)
  const items = git ? await tracked(root) : await walk(root, root)
  return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b))
}

async function isgit(root: string): Promise<boolean> {
  const proc = Bun.spawn(["git", "rev-parse", "--is-inside-work-tree"], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  return code === 0 && text.trim() === "true"
}

async function tracked(root: string): Promise<string[]> {
  const proc = Bun.spawn(["git", "ls-files", "-co", "--exclude-standard", "-z", "--", "."], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  if (code !== 0) return walk(root, root)
  return text.split("\0").filter(Boolean)
}

async function walk(root: string, dir: string): Promise<string[]> {
  const list = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    list
      .filter((item) => !skip(item.name))
      .map(async (item) => {
        const full = path.join(dir, item.name)
        const rel = path.relative(root, full).replaceAll("\\", "/")
        if (item.isDirectory()) return walk(root, full)
        if (item.isFile() || item.isSymbolicLink()) return [rel]
        return []
      }),
  )
  return nested.flat()
}

function skip(name: string): boolean {
  return name === ".git" || name === "node_modules" || name === ".DS_Store"
}

async function inspect(root: string, rel: string): Promise<File | undefined> {
  const full = path.join(root, rel)
  const info = await stat(full).catch(() => undefined)
  if (!info) return undefined
  if (!info.isFile()) return undefined
  const size = info.size
  if (isHighRiskPath(rel)) {
    return { path: rel, kind: "file", size, hash: "", omitted: { reason: "high_risk_path" } }
  }
  if (size > Config.maxPayloadBytes) {
    return { path: rel, kind: "file", size, hash: "", omitted: { reason: "large" } }
  }
  const bytes = await readFile(full).catch(() => undefined)
  if (!bytes) return { path: rel, kind: "file", size, hash: "", omitted: { reason: "error" } }
  const hash = sha(bytes)
  if (binary(bytes)) return { path: rel, kind: "file", size, hash, omitted: { reason: "binary" } }
  return { path: rel, kind: "file", size, hash, content: bytes.toString("utf8") }
}

function binary(bytes: Buffer): boolean {
  return bytes.subarray(0, Math.min(bytes.byteLength, 8_000)).includes(0)
}

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function hash(files: Map<string, File>): string {
  const text = [...files.values()].map((file) => `${file.path}\0${file.hash}\0${file.size}`).join("\0")
  return sha(Buffer.from(text, "utf8"))
}

function entry(file: File): FileEntry {
  return {
    path: file.path,
    kind: file.kind,
    size: file.size,
    hash: file.hash || undefined,
    content: file.content,
    omitted: file.omitted,
  }
}

function delta(prev: Map<string, File>, next: Map<string, File>): DeltaEntry[] {
  const paths = Array.from(new Set([...prev.keys(), ...next.keys()])).sort((a, b) => a.localeCompare(b))
  return paths.flatMap((rel) => {
    const before = prev.get(rel)
    const after = next.get(rel)
    if (!before && after) return [patch(rel, "added", "", after.content ?? "")]
    if (before && !after) return [patch(rel, "removed", before.content ?? "", "")]
    if (!before || !after || before.hash === after.hash) return []
    return [patch(rel, "modified", before.content ?? "", after.content ?? "")]
  })
}

function patch(rel: string, status: DeltaEntry["status"], before: string, after: string): DeltaEntry {
  return {
    path: rel,
    status,
    additions: lines(after),
    deletions: lines(before),
    patchChunkIds: [],
    patch: formatPatch(structuredPatch(rel, rel, before, after, "", "", { context: Number.MAX_SAFE_INTEGER })),
  }
}

function lines(text: string): number {
  if (!text) return 0
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length
}
