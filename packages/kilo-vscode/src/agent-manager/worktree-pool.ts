/**
 * WorktreePool - Pre-creates detached git worktrees so new Agent Manager
 * sessions can claim a ready worktree instead of paying the full
 * `git worktree add` checkout cost.
 *
 * Slots are created at their final path under `.kilo/worktrees/` and tagged
 * with pooled metadata. A later claim turns a
 * slot into a named branch with a cheap ref update (exact match) or a bounded
 * checkout (small delta). This module is vscode-free so it can be tested with a
 * real temporary git repository.
 */

import * as path from "path"
import * as fs from "fs"
import type { SimpleGit } from "simple-git"
import { generateBranchName } from "./branch-name"
import { normalizePath, parseWorktreeList } from "./git-import"

const METADATA_FILE = "kilo-agent-manager-metadata.json"
/** Maximum commits between a slot base and the requested base for a delta claim. */
const MAX_DELTA = 50

export interface PoolStart {
  ref: string
  branch: string
  remote?: string
}

export interface PoolDeps {
  root: string
  dir: string
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
    const exact = this.slots.find((slot) => slot.baseOid === oid)
    if (exact) return this.take(exact, branch, oid, true, auto)
    const delta = await this.findDelta(oid)
    if (!delta) return undefined
    return this.take(delta, branch, oid, false, auto)
  }

  /** True when at least one slot is available. Pure in-memory check. */
  has(): boolean {
    return this.size() > 0 && this.slots.length > 0
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

  private async fill(point: PoolStart, oid: string): Promise<void> {
    if (this.size() <= 0) return
    await fs.promises.mkdir(this.deps.dir, { recursive: true })

    await this.prune()
    await this.retarget(point, oid)
    const missing = this.size() - this.slots.length
    if (missing <= 0) return

    const names = await this.dirNames()
    for (let i = 0; i < missing; i++) {
      const slot = await this.build(point, oid, names)
      if (!slot) continue
      names.push(path.basename(slot.path))
      this.slots.push(slot)
    }
  }

  private async build(point: PoolStart, oid: string, names: string[]): Promise<PoolSlot | undefined> {
    const name = generateBranchName("pool", names)
    const slotPath = path.join(this.deps.dir, name)
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

  private async adopt(): Promise<void> {
    if (!fs.existsSync(this.deps.dir)) return
    const known = new Set(this.slots.map((slot) => normalizePath(slot.path)))
    const entries = await fs.promises.readdir(this.deps.dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".kilo-delete-")) continue
      const slotPath = path.join(this.deps.dir, entry.name)
      if (known.has(normalizePath(slotPath))) continue
      const meta = await this.readMeta(slotPath)
      if (!meta?.pooled) continue
      if (meta.owner !== process.pid && this.alive(meta.owner)) continue
      // Turning the feature off must clean slots owned by this or a dead process.
      if (this.size() <= 0) {
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
    const alive: PoolSlot[] = []
    for (const slot of this.slots) {
      if (await this.registered(slot.path)) {
        alive.push(slot)
        continue
      }
      await this.removePath(slot.path)
    }
    this.slots = alive
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

  private async dirNames(): Promise<string[]> {
    if (!fs.existsSync(this.deps.dir)) return []
    const entries = await fs.promises.readdir(this.deps.dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
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
    return this.readMetaFile(await this.metaPath(wtPath))
  }

  private async readMetaFile(file: string | undefined): Promise<PoolMeta | undefined> {
    if (!file) return undefined
    // A missing file is the normal case for a non-pooled worktree, so stay quiet.
    const content = await fs.promises.readFile(file, "utf-8").catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") this.deps.log(`worktree pool: read metadata ${file}: ${e}`)
      return undefined
    })
    if (content === undefined) return undefined
    return await Promise.resolve()
      .then(() => JSON.parse(content) as PoolMeta)
      .catch((e) => {
        this.deps.log(`worktree pool: parse metadata ${file}: ${e}`)
        return undefined
      })
  }

  private alive(pid: number | undefined): boolean {
    if (pid === undefined) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM"
    }
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
