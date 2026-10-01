/**
 * WorktreePool - Pre-creates detached git worktrees so new Agent Manager
 * sessions can claim a ready worktree instead of paying the full
 * `git worktree add` checkout cost.
 *
 * Slots are tagged with pooled metadata. A later claim turns a slot into a
 * named branch with a cheap ref update (exact match) or a bounded checkout
 * (small delta). This module is vscode-free so it can be tested with a real
 * temporary git repository.
 *
 * Slots live in a per-user directory outside the project when possible. A slot
 * is a full checkout, and inside the project every tool that walks the tree
 * sees it: `conda-build .` finds a second recipe, test runners collect
 * duplicate tests, file watchers and language servers index a copy. Ignore
 * rules do not help, because these tools do not read them. The claim moves the
 * slot into `.kilo/worktrees/`. `git worktree move` is a plain rename, so the
 * per-user directory is only used on the same filesystem as the project.
 */

import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import { createHash } from "crypto"
import type { SimpleGit } from "simple-git"
import { generateBranchName, sanitizeBranchName } from "./branch-name"
import { normalizePath, parseWorktreeList } from "./git-import"
import { pathKey } from "./project/paths"
import { markNoIndex } from "../util/spotlight"

const METADATA_FILE = "kilo-agent-manager-metadata.json"
/** Maximum commits between a slot base and the requested base for a delta claim. */
const MAX_DELTA = 50
/** A slot that no live process owns and that nothing touched for this long is removed by {@link sweep}. */
const STALE = 14 * 24 * 60 * 60 * 1000

/** Per-user pool home next to the Kilo CLI data. Honors `XDG_DATA_HOME` and is never roaming on Windows. */
export function poolHome(): string {
  const data = process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share")
  return path.join(data, "kilo", "worktree-pool")
}

/** Stable slot directory for one repository root. The readable prefix helps users who inspect disk usage. */
export function poolDir(home: string, root: string): string {
  const slug = sanitizeBranchName(path.basename(root), 32) || "repo"
  const hash = createHash("sha256").update(pathKey(root)).digest("hex").slice(0, 12)
  return path.join(home, `${slug}-${hash}`)
}

/**
 * Select the directory for new slots: `shared` when a rename from it into the
 * project can work, otherwise `local`. Creates only the pool home, never
 * anything in the project.
 */
export async function locate(root: string, shared: string, local: string, log: (msg: string) => void): Promise<string> {
  const home = path.dirname(shared)
  const same = await fs.promises
    .mkdir(home, { recursive: true })
    .then(() => Promise.all([fs.promises.stat(root), fs.promises.stat(home)]))
    .then(([a, b]) => a.dev === b.dev)
    .catch((e) => {
      log(`worktree pool: cannot use ${home}: ${e}`)
      return false
    })
  if (!same) {
    log(`worktree pool: ${home} is on another filesystem than ${root}, keeping slots in ${local}`)
    return local
  }
  await markNoIndex(home, log)
  return shared
}

/**
 * Remove slots that no Kilo process can claim, across every repository in the
 * pool home. A slot whose repository is gone (deleted, moved, or pruned) is
 * removed at once. Other slots are removed when no live process owns them and
 * nothing touched them for {@link STALE}, or at once when the pool is disabled.
 * Without this, a deleted project leaves a full checkout behind in a directory
 * the user never sees.
 */
export async function sweep(
  home: string,
  enabled: boolean,
  client: (cwd: string) => SimpleGit,
  log: (msg: string) => void,
): Promise<void> {
  const age = enabled ? STALE : 0
  for (const project of await subdirs(home)) {
    const dir = path.join(home, project)
    for (const name of await subdirs(dir)) await reap(path.join(dir, name), age, client, log)
    await fs.promises.rmdir(dir).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOTEMPTY" && e.code !== "EEXIST") log(`worktree pool: remove ${dir}: ${e}`)
    })
  }
}

async function reap(slot: string, age: number, client: (cwd: string) => SimpleGit, log: (msg: string) => void) {
  const gitdir = await linked(slot)
  // git creates the registration before it writes the `.git` file, so a
  // missing target means git no longer tracks this slot.
  if (gitdir && !fs.existsSync(gitdir)) {
    log(`worktree pool: removing slot of a missing repository ${slot}`)
    return purge(slot, log)
  }
  const file = gitdir ? path.join(gitdir, METADATA_FILE) : undefined
  const meta = file ? await readMeta(file, log) : undefined
  if (meta?.pooled && alive(meta.owner)) return
  // A slot without metadata can still be in creation by another process.
  const wait = meta?.pooled ? age : Math.max(age, 60 * 60 * 1000)
  // Metadata is rewritten whenever a process adopts or retargets the slot.
  const stamp = await fs.promises
    .stat(meta && file ? file : slot)
    .then((stat) => stat.mtimeMs)
    .catch(() => undefined)
  if (stamp === undefined || Date.now() - stamp < wait) return
  log(`worktree pool: removing unused slot ${slot}`)
  if (gitdir) {
    // simple-git throws at once when the directory vanished meanwhile.
    await Promise.resolve()
      .then(() => client(slot).raw(["worktree", "remove", "--force", "--force", slot]))
      .catch((e) => log(`worktree pool: remove ${slot}: ${e}`))
  }
  if (fs.existsSync(slot)) await purge(slot, log)
}

async function purge(dir: string, log: (msg: string) => void): Promise<void> {
  await fs.promises.rm(dir, { recursive: true, force: true }).catch((e) => log(`worktree pool: rm ${dir}: ${e}`))
}

async function subdirs(dir: string): Promise<string[]> {
  if (!fs.existsSync(dir)) return []
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

/** Git directory a linked worktree points at, or undefined when it has no `.git` file. */
async function linked(dir: string): Promise<string | undefined> {
  const content = await fs.promises.readFile(path.join(dir, ".git"), "utf-8").catch(() => undefined)
  const match = content?.match(/^gitdir:\s*(.+)$/m)
  return match ? path.resolve(dir, match[1].trim()) : undefined
}

async function readMeta(file: string, log: (msg: string) => void): Promise<PoolMeta | undefined> {
  // A missing file is the normal case for a non-pooled worktree, so stay quiet.
  const content = await fs.promises.readFile(file, "utf-8").catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") log(`worktree pool: read metadata ${file}: ${e}`)
    return undefined
  })
  if (content === undefined) return undefined
  return await Promise.resolve()
    .then(() => JSON.parse(content) as PoolMeta)
    .catch((e) => {
      log(`worktree pool: parse metadata ${file}: ${e}`)
      return undefined
    })
}

function alive(pid: number | undefined): boolean {
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}

export interface PoolStart {
  ref: string
  branch: string
  remote?: string
}

export interface PoolDeps {
  root: string
  /** Directory for new slots. Resolved on first use, because it depends on the filesystem layout. */
  dir: () => Promise<string>
  /** Every directory that can hold slots of this repository, including the one `dir` resolves to. */
  dirs: string[]
  /** Target slot count. A function is read live so a settings change applies without a restart. */
  poolSize: number | (() => number)
  log: (msg: string) => void
  client: (cwd: string) => SimpleGit
  lock: <T>(fn: () => Promise<T>) => Promise<T>
  /** Resolve the git directory for a worktree so pool metadata can be written. */
  gitdir: (wtPath: string) => Promise<string | undefined>
  /** Cache-aware start point resolution. Must not force a fresh network fetch. */
  start: (base?: string) => Promise<PoolStart>
}

interface PoolSlot {
  path: string
  baseRef: string
  baseOid: string
  ready: Promise<string>
  refreshed: boolean
}

interface PoolMeta {
  pooled?: boolean
  owner?: number
  baseRef?: string
  baseOid?: string
}

export class WorktreePool {
  private readonly deps: PoolDeps
  private slots: PoolSlot[] = []
  private warming = false

  /** Current target size, read live when configured with a function. */
  private size(): number {
    return typeof this.deps.poolSize === "function" ? this.deps.poolSize() : this.deps.poolSize
  }

  constructor(deps: PoolDeps) {
    this.deps = deps
  }

  /**
   * Fire-and-forget warm-up. Idempotent and at most one warm runs at a time.
   * The start point (which may fetch when the 60 s cache is cold) is resolved
   * before the git lock is taken, so user operations never wait on the network.
   */
  warm(base?: string): void {
    if (this.size() <= 0 || this.warming) return
    this.warming = true
    queueMicrotask(() => {
      void this.resolve(base)
        .then((start) => this.deps.lock(() => this.fill(start.point, start.oid)))
        .catch((e) => this.deps.log(`worktree pool: warm failed: ${e}`))
        .finally(() => {
          this.warming = false
        })
    })
  }

  /** Resolve the base ref and its commit outside the git lock. */
  private async resolve(base?: string): Promise<{ point: PoolStart; oid: string }> {
    const point = await this.deps.start(base)
    const oid = (await this.deps.client(this.deps.root).raw(["rev-parse", "--verify", `${point.ref}^{commit}`])).trim()
    return { point, oid }
  }

  /**
   * Claim a ready slot for a new branch. Runs while the caller already holds
   * the git lock. Returns the slot path on success, or undefined to fall back
   * to a normal `git worktree add`.
   */
  async claim(branch: string, oid: string, auto = false): Promise<{ path: string; branch: string } | undefined> {
    if (!this.has()) return undefined
    // take() discards a slot it cannot use (for example one deleted on disk),
    // so keep trying the remaining slots, exact base first, then a small delta,
    // before falling back to a cold worktree add.
    for (const slot of this.slots.filter((known) => known.baseOid === oid)) {
      const claimed = await this.take(slot, branch, oid, true, auto)
      if (claimed) return claimed
    }
    for (let left = this.slots.length; left > 0; left--) {
      const delta = await this.findDelta(oid)
      if (!delta) return undefined
      const claimed = await this.take(delta, branch, oid, false, auto)
      if (claimed) return claimed
    }
    return undefined
  }

  /** True when at least one slot is available. Pure in-memory check. */
  has(): boolean {
    return this.size() > 0 && this.slots.length > 0
  }

  /** True when the pool is configured to hold at least one slot. */
  enabled(): boolean {
    return this.size() > 0
  }

  /** Adopt leftover pooled slots from a previous run and discard broken ones. */
  async reconcile(): Promise<void> {
    await this.deps.lock(() => this.adopt())
  }

  /** Remove every idle slot, used when the feature is turned off in settings. */
  async dispose(): Promise<void> {
    await this.deps.lock(async () => {
      const slots = this.slots
      this.slots = []
      for (const slot of slots) await this.removePath(slot.path)
    })
  }

  /** Forget a slot so the normal removal path can clean it up. */
  release(wtPath: string): void {
    this.slots = this.slots.filter((slot) => normalizePath(slot.path) !== normalizePath(wtPath))
  }

  /** Remove a claimed slot that could not be moved into place. Runs while the caller holds the git lock. */
  async drop(wtPath: string): Promise<void> {
    this.release(wtPath)
    await this.removePath(wtPath)
  }

  private async fill(point: PoolStart, oid: string): Promise<void> {
    if (this.size() <= 0) return
    const dir = await this.deps.dir()
    await fs.promises.mkdir(dir, { recursive: true })

    await this.prune()
    await this.retarget(point, oid)
    const missing = this.size() - this.slots.length
    if (missing <= 0) return

    // A claim can reuse the slot name for the branch and its folder in
    // `.kilo/worktrees/`, so avoid names that are taken in any slot directory.
    const names = (await Promise.all(this.deps.dirs.map(subdirs))).flat()
    for (let i = 0; i < missing; i++) {
      const slot = await this.build(point, oid, dir, names)
      if (!slot) continue
      names.push(path.basename(slot.path))
      this.slots.push(slot)
    }
  }

  private async build(point: PoolStart, oid: string, dir: string, names: string[]): Promise<PoolSlot | undefined> {
    const name = generateBranchName("pool", names)
    const slotPath = path.join(dir, name)
    const ok = await this.attempt(async () => {
      await this.raw(["worktree", "add", "--detach", slotPath, oid])
      await this.writeMeta(slotPath, { pooled: true, owner: process.pid, baseRef: point.ref, baseOid: oid })
    }, `create slot ${slotPath}`)
    if (!ok) {
      await this.removePath(slotPath)
      return undefined
    }

    const slot: PoolSlot = {
      path: slotPath,
      baseRef: point.ref,
      baseOid: oid,
      ready: Promise.resolve(oid),
      refreshed: false,
    }
    this.refresh(slot)
    return slot
  }

  private refresh(slot: PoolSlot): void {
    void Promise.resolve()
      .then(() => this.deps.client(slot.path).raw(["status", "--porcelain"]))
      .then(() => {
        slot.refreshed = true
      })
      .catch((e) => this.deps.log(`worktree pool: status refresh failed for ${slot.path}: ${e}`))
  }

  private async take(
    slot: PoolSlot,
    requested: string,
    oid: string,
    exact: boolean,
    auto: boolean,
  ): Promise<{ path: string; branch: string } | undefined> {
    // A slot can be deleted on disk outside the pool, for example by a
    // worktree-hygiene script. simple-git throws when constructed on a missing
    // directory, so validate the slot before touching it and evict the stale
    // entry instead of failing the whole creation.
    if (!fs.existsSync(path.join(slot.path, ".git"))) {
      this.deps.log(`worktree pool: slot missing on disk, evicting ${slot.path}`)
      await this.discard(slot)
      return undefined
    }
    const git = this.deps.client(slot.path)
    // For generated names, reuse the slot directory name as the branch so the
    // worktree folder and branch keep matching, as they do without the pool.
    // Try the slot name first; if that branch already exists, use the requested one.
    const name = path.basename(slot.path)
    const own = auto && name !== requested
    const make = (branch: string) =>
      exact
        ? this.attempt(() => git.raw(["branch", branch, "HEAD"]), `branch ${branch}`)
        : this.attempt(() => git.raw(["checkout", "-b", branch, oid]), `checkout ${branch}`)
    const first = own && (await make(name))
    const branch = first ? name : requested
    const made = first || (await make(requested))
    if (!made) {
      await this.discard(slot)
      return undefined
    }

    if (exact) {
      const linked = await this.attempt(
        () => git.raw(["symbolic-ref", "HEAD", `refs/heads/${branch}`]),
        `symbolic-ref ${branch}`,
      )
      if (!linked) {
        await this.deleteBranch(branch)
        await this.discard(slot)
        return undefined
      }
    }

    await this.attempt(() => this.clearMeta(slot.path), `clear metadata ${slot.path}`)
    this.slots = this.slots.filter((known) => known !== slot)
    return { path: slot.path, branch }
  }

  private async findDelta(oid: string): Promise<PoolSlot | undefined> {
    const ordered = [...this.slots].sort((a, b) => Number(b.refreshed) - Number(a.refreshed))
    for (const slot of ordered) {
      if (!(await this.withinDelta(slot.baseOid, oid))) continue
      return slot
    }
    return undefined
  }

  private async withinDelta(from: string, to: string): Promise<boolean> {
    const ok = await this.attemptValue(async () => {
      const raw = await this.raw(["rev-list", "--count", `${from}..${to}`])
      return parseInt(raw.trim(), 10) <= MAX_DELTA
    }, `rev-list ${from}..${to}`)
    return ok === true
  }

  /**
   * Adopt slots in the directory for new slots. Slots in other directories,
   * for example `.kilo/worktrees/` slots from an older version, are removed.
   */
  private async adopt(): Promise<void> {
    const active = this.size() > 0 ? await this.deps.dir() : undefined
    for (const dir of this.deps.dirs) await this.collect(dir, dir === active)
  }

  private async collect(dir: string, keep: boolean): Promise<void> {
    if (!fs.existsSync(dir)) return
    const known = new Set(this.slots.map((slot) => normalizePath(slot.path)))
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".kilo-delete-")) continue
      const slotPath = path.join(dir, entry.name)
      if (known.has(normalizePath(slotPath))) continue
      const meta = await this.readMeta(slotPath)
      if (!meta?.pooled) continue
      if (meta.owner !== process.pid && alive(meta.owner)) continue
      // Turning the feature off must clean slots owned by this or a dead process.
      if (!keep) {
        await this.removePath(slotPath)
        continue
      }
      // Trust the worktree's real HEAD over persisted metadata: a crash between
      // a retarget checkout and its metadata write leaves them different.
      const head = await this.attemptValue(
        async () => (await this.deps.client(slotPath).raw(["rev-parse", "--verify", "HEAD^{commit}"])).trim(),
        `resolve HEAD ${slotPath}`,
      )
      const usable = head !== undefined && head !== "" && (await this.registered(slotPath))
      if (!usable || this.slots.length >= this.size()) {
        await this.removePath(slotPath)
        continue
      }
      await this.writeMeta(slotPath, {
        pooled: true,
        owner: process.pid,
        baseRef: meta.baseRef,
        baseOid: head,
      })
      this.slots.push({
        path: slotPath,
        baseRef: meta.baseRef ?? "",
        baseOid: head,
        ready: Promise.resolve(head),
        refreshed: false,
      })
    }
  }

  /** Move stale slots to the current base so a later claim stays an exact match. */
  private async retarget(point: PoolStart, oid: string): Promise<void> {
    for (const slot of [...this.slots]) {
      if (slot.baseOid === oid) continue
      const ok = await this.attempt(
        () => this.deps.client(slot.path).raw(["checkout", "--detach", oid]),
        `retarget ${slot.path}`,
      )
      if (!ok) {
        await this.discard(slot)
        continue
      }
      slot.baseOid = oid
      slot.baseRef = point.ref
      slot.refreshed = false
      await this.writeMeta(slot.path, { pooled: true, owner: process.pid, baseRef: point.ref, baseOid: oid })
      this.refresh(slot)
    }
  }

  private async prune(): Promise<void> {
    const kept: PoolSlot[] = []
    for (const slot of this.slots) {
      if (await this.registered(slot.path)) {
        kept.push(slot)
        continue
      }
      await this.removePath(slot.path)
    }
    this.slots = kept
  }

  private async registered(wtPath: string): Promise<boolean> {
    if (!fs.existsSync(path.join(wtPath, ".git"))) return false
    const raw = await this.raw(["worktree", "list", "--porcelain"]).catch((e) => {
      this.deps.log(`worktree pool: worktree list failed: ${e}`)
      return ""
    })
    const target = await this.canonical(wtPath)
    for (const entry of parseWorktreeList(raw)) {
      if ((await this.canonical(entry.path)) === target) return true
    }
    return false
  }

  /** Resolve symlinked temp paths (macOS /var) before comparing worktree paths. */
  private async canonical(target: string): Promise<string> {
    return fs.promises.realpath(target).catch(() => normalizePath(target))
  }

  private async discard(slot: PoolSlot): Promise<void> {
    this.slots = this.slots.filter((known) => known !== slot)
    await this.removePath(slot.path)
  }

  private async removePath(wtPath: string): Promise<void> {
    await this.raw(["worktree", "remove", "--force", "--force", wtPath]).catch((e) => {
      this.deps.log(`worktree pool: remove failed for ${wtPath}: ${e}`)
    })
    if (fs.existsSync(wtPath)) {
      await fs.promises.rm(wtPath, { recursive: true, force: true }).catch((e) => {
        this.deps.log(`worktree pool: rm failed for ${wtPath}: ${e}`)
      })
    }
    await this.raw(["worktree", "prune", "--expire", "now"]).catch((e) => {
      this.deps.log(`worktree pool: prune failed: ${e}`)
    })
  }

  private async deleteBranch(branch: string): Promise<void> {
    await this.raw(["branch", "-D", branch]).catch((e) => {
      this.deps.log(`worktree pool: failed to delete branch ${branch}: ${e}`)
    })
  }

  private raw(args: string[]): Promise<string> {
    return this.deps.client(this.deps.root).raw(args)
  }

  private async metaPath(wtPath: string): Promise<string | undefined> {
    const dir = await this.attemptValue(() => this.deps.gitdir(wtPath), `resolve gitdir ${wtPath}`)
    return dir ? path.join(dir, METADATA_FILE) : undefined
  }

  private async writeMeta(wtPath: string, meta: PoolMeta): Promise<void> {
    const file = await this.metaPath(wtPath)
    if (!file) return
    await fs.promises.writeFile(file, JSON.stringify(meta), "utf-8")
  }

  private async clearMeta(wtPath: string): Promise<void> {
    const file = await this.metaPath(wtPath)
    if (!file) return
    await fs.promises.writeFile(file, "{}", "utf-8")
  }

  private async readMeta(wtPath: string): Promise<PoolMeta | undefined> {
    const file = await this.metaPath(wtPath)
    return file ? readMeta(file, this.deps.log) : undefined
  }

  private async attempt(fn: () => Promise<unknown>, label: string): Promise<boolean> {
    try {
      await fn()
      return true
    } catch (e) {
      this.deps.log(`worktree pool: ${label}: ${e}`)
      return false
    }
  }

  private async attemptValue<T>(fn: () => Promise<T>, label: string): Promise<T | undefined> {
    try {
      return await fn()
    } catch (e) {
      this.deps.log(`worktree pool: ${label}: ${e}`)
      return undefined
    }
  }
}
