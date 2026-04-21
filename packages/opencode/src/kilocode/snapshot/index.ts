// kilocode_change - new file
import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "../../util/filesystem"
import { Log } from "../../util/log"
import { Global } from "../../global"
import { Instance } from "../../project/instance"
import { Flag } from "@/flag/flag"
import type { Snapshot } from "@/snapshot"

const log = Log.create({ service: "snapshot" })

// ---------------------------------------------------------------------------
// Worktree-scoped snapshot git dir (relocated from kilocode/snapshot.ts)
// ---------------------------------------------------------------------------

/** Worktree-scoped snapshot git dir (isolated per worktree). */
export function gitdir() {
  const project = Instance.project
  const workhash = Bun.hash(Instance.worktree).toString(36)
  return path.join(Global.Path.data, "snapshot", project.id, workhash)
}

/** Original project-scoped snapshot git dir (pre-isolation layout). */
function legacydir() {
  const project = Instance.project
  return path.join(Global.Path.data, "snapshot", project.id)
}

/** Initialize a bare snapshot git repo if it doesn't exist yet. */
export async function ensureGit(git: string) {
  if (!(await fs.mkdir(git, { recursive: true }))) return
  await $`git init`
    .env({
      ...process.env,
      GIT_DIR: git,
      GIT_WORK_TREE: Instance.worktree,
    })
    .quiet()
    .nothrow()
  await $`git --git-dir ${git} config core.autocrlf false`.quiet().nothrow()
  await $`git --git-dir ${git} config core.longpaths true`.quiet().nothrow()
  await $`git --git-dir ${git} config core.symlinks true`.quiet().nothrow()
  await $`git --git-dir ${git} config core.fsmonitor false`.quiet().nothrow()
  log.info("initialized")
}

/** Point the worktree repo's alternates at the legacy object store. */
export async function syncAlternates(git: string) {
  const legacy = legacydir()
  if (legacy === git) return
  const objects = path.join(legacy, "objects")
  const exists = await fs
    .stat(objects)
    .then(() => true)
    .catch(() => false)
  const target = path.join(git, "objects", "info", "alternates")
  await fs.mkdir(path.join(git, "objects", "info"), { recursive: true })
  await Filesystem.write(target, exists ? objects + "\n" : "")
}

/** Return a ready-to-use snapshot git dir (init + alternates). */
export async function prepare() {
  const git = gitdir()
  await ensureGit(git)
  await syncAlternates(git)
  return git
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_DIFF_SIZE = 256 * 1024

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** ACP guard: returns true when snapshots should be disabled for ACP clients. */
export function acpDisabled(): boolean {
  return Flag.KILO_CLIENT === "acp"
}

/** Check whether a file size exceeds the diff size threshold. */
export function oversized(size: number): boolean {
  return size > MAX_DIFF_SIZE
}

// ---------------------------------------------------------------------------
// Batched revert helpers
// ---------------------------------------------------------------------------

export interface RevertOp {
  hash: string
  file: string
  rel: string
}

export function pathsClash(a: string, b: string) {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

export function canBatch(batch: RevertOp[], op: RevertOp): boolean {
  if (batch.length >= 100) return false
  if (op.hash !== batch[0]!.hash) return false
  if (batch.some((existing) => pathsClash(existing.rel, op.rel))) return false
  return true
}

export function groupIntoBatches(ops: RevertOp[]): RevertOp[][] {
  const batches: RevertOp[][] = []
  let batch: RevertOp[] = []
  for (const op of ops) {
    if (batch.length > 0 && !canBatch(batch, op)) {
      batches.push(batch)
      batch = []
    }
    batch.push(op)
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}

// ---------------------------------------------------------------------------
// diffFull cache
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<Snapshot.FileDiff[]>>()
const CACHE_MAX = 100

export function diffFullCached(
  fn: (from: string, to: string) => Promise<Snapshot.FileDiff[]>,
  from: string,
  to: string,
): Promise<Snapshot.FileDiff[]> {
  if (from === to) return Promise.resolve([])
  const key = `${from}:${to}`
  const hit = cache.get(key)
  if (hit) return hit
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value
    if (first) cache.delete(first)
  }
  const pending = fn(from, to).catch((err) => {
    cache.delete(key)
    throw err
  })
  cache.set(key, pending)
  return pending
}
