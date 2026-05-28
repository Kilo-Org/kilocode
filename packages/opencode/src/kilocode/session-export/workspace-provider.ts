import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { formatPatch, structuredPatch } from "diff"
import { Config } from "./config"
import type { CaptureMetadata, DeltaEntry, FileEntry } from "./events"
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
  const pending = new Set<string>()

  const capture = async () => {
    const result = await scan(opts.root)
    const files = result.files
    const id = hash(files)
    snapshots.set(id, files)
    state.snapshots[id] = [...files.values()]
    pending.add(id)
    setTimeout(() => pending.delete(id), 0).unref?.()
    save(opts.statePath, state)
    return { id, files, capture: metadata(result.mode, files) }
  }

  return {
    current(sessionId: string): string | undefined {
      return state.sessions[sessionId]
    },
    remember(sessionId: string, snapshotId: string): void {
      state.sessions[sessionId] = snapshotId
      pending.delete(snapshotId)
      prune(state, snapshots, pending)
      save(opts.statePath, state)
    },
    async baseline(): Promise<{ snapshotId: string; files: FileEntry[]; capture: CaptureMetadata }> {
      const snap = await capture()
      return { snapshotId: snap.id, files: [...snap.files.values()].map(entry), capture: snap.capture }
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

function prune(state: State, snapshots: Map<string, Map<string, File>>, pending: Set<string>): void {
  const used = new Set([...Object.values(state.sessions), ...pending])
  for (const id of Object.keys(state.snapshots)) {
    if (used.has(id)) continue
    delete state.snapshots[id]
    snapshots.delete(id)
  }
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

async function scan(root: string): Promise<{ files: Map<string, File>; mode: CaptureMetadata["mode"] }> {
  const repo = await repository(root)
  if (!repo) return { files: new Map(), mode: "none" }
  const paths = await tracked(repo)
  const files = await Promise.all(paths.map((item) => inspect(repo, item)))
  const out = new Map<string, File>()
  for (const file of files.filter((item): item is File => Boolean(item))) out.set(file.path, file)
  return { files: out, mode: "git-tracked-and-untracked" }
}

async function repository(root: string): Promise<string | undefined> {
  const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  if (code !== 0) return
  const repo = text.trim()
  if (!repo) return
  return path.resolve(repo)
}

async function tracked(root: string): Promise<string[]> {
  const proc = Bun.spawn(["git", "ls-files", "-co", "--exclude-standard", "-z", "--", "."], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  if (code !== 0) return []
  return Array.from(new Set(text.split("\0").filter(Boolean))).sort((a, b) => a.localeCompare(b))
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

function metadata(mode: CaptureMetadata["mode"], files: Map<string, File>): CaptureMetadata {
  return {
    mode,
    fileCount: files.size,
    totalBytes: [...files.values()].reduce((sum, file) => sum + file.size, 0),
    omittedCountsByReason: omitted(files),
    truncated: false,
  }
}

function omitted(files: Map<string, File>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const file of files.values()) {
    const reason = file.omitted?.reason
    if (!reason) continue
    out[reason] = (out[reason] ?? 0) + 1
  }
  return out
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
