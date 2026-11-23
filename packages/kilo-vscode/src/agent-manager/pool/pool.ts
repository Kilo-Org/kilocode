/**
 * WorktreePool - Pre-creates detached git worktrees so new Agent Manager
 * sessions can claim a ready worktree instead of paying the full
 * `git worktree add` checkout cost.
 *
 * Slots are warmed in the per-user pool home (see `home.ts`), never in the
 * project, and tagged with pooled metadata. A claim turns a slot into a named
 * branch with a cheap ref update (exact match) or a bounded checkout (small
 * delta), then moves it to `.kilo/worktrees/<branch>`. A claimed slot is never
 * left in the pool home: when the move fails, the slot and its branch are
 * removed and the caller falls back to a normal `git worktree add`.
 *
 * The pool also removes slots that older versions left in `.kilo/worktrees/`,
 * and runs the machine-wide sweep (see `sweep.ts`) once per process. This
 * module is vscode-free so it can be tested with a real temporary repository.
 */

import * as path from "path"
import * as fs from "fs"
import type { SimpleGit } from "simple-git"
import { generateBranchName } from "../branch-name"
import { normalizePath, parseWorktreeList } from "../git-import"
import { locate, poolDir } from "./home"
import { METADATA_FILE, alive, readMeta, subdirs, type PoolMeta } from "./slot"
import { sweep } from "./sweep"

/** Maximum commits between a slot base and the requested base for a delta claim. */
const MAX_DELTA = 50
/** Spotlight marker that `.kilo/worktrees/` can hold without any worktree in it. */
const MARKER = ".metadata_never_index"

export interface PoolStart {
  ref: string
  branch: string
  remote?: string
}

export interface PoolDeps {
  root: string
  /** Per-user pool home shared by every repository. Without it, no slots are pre-warmed. */
  home?: string
  /** The project's `.kilo/worktrees/`. Claimed slots move here, and older versions left slots here. */
  local: string
  /** Folder name in {@link local} for a branch. */
  folder: (branch: string) => string
  /** Target slot count. A function is read live so a settings change applies without a restart. */
  poolSize: number | (() => number)
  /** Delay before a claimed slot is replaced, so the warm-up does not compete with the new session. */
  rewarm: () => number
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

export class WorktreePool {
  // Pool homes already swept by this process, keyed by home and pool state.
  private static swept = new Set<string>()
  private readonly deps: PoolDeps
  /** This repository's slot directory in the pool home. */
  private readonly shared: string | undefined
  /** Every directory that can hold slots of this repository: the pool home and older `.kilo/worktrees/`. */
  private readonly dirs: string[]
  /** Resolved directory for new slots, see {@link dir}. */
  private place: Promise<string | undefined> | undefined
  private slots: PoolSlot[] = []
  private warming = false

  /** Current target size, read live when configured with a function. */
  private size(): number {
    return typeof this.deps.poolSize === "function" ? this.deps.poolSize() : this.deps.poolSize
  }

  constructor(deps: PoolDeps) {
    this.deps = deps
    this.shared = deps.home ? poolDir(deps.home, deps.root) : undefined
    this.dirs = this.shared ? [this.shared, deps.local] : [deps.local]
  }

  /**
   * Directory for new slots: this repository's directory in the pool home
   * when it is on the same filesystem, otherwise undefined and no slots.
   */
  private dir(): Promise<string | undefined> {
    if (!this.shared) return Promise.resolve(undefined)
    this.place ??= locate(this.deps.root, this.shared, this.deps.log)
    return this.place
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
   * Claim a ready slot for a new branch and move it to `.kilo/worktrees/`.
   * Runs while the caller already holds the git lock. Returns the worktree on
   * success, or undefined to fall back to a normal `git worktree add`. A
   * replacement slot is warmed after {@link PoolDeps.rewarm}.
   */
  async claim(
    branch: string,
    oid: string,
    auto = false,
    base?: string,
  ): Promise<{ path: string; branch: string } | undefined> {
    if (!this.has()) return undefined
    const taken = await this.pick(branch, oid, auto)
    if (!taken) return undefined
    setTimeout(() => this.warm(base), this.deps.rewarm())
    return this.move(taken)
  }

  /**
   * take() discards a slot it cannot use (for example one deleted on disk),
   * so keep trying the remaining slots, exact base first, then a small delta,
   * before falling back to a cold worktree add.
   */
  private async pick(
    branch: string,
    oid: string,
    auto: boolean,
  ): Promise<{ path: string; branch: string } | undefined> {
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

  /**
   * Move a claimed slot to `.kilo/worktrees/<branch>`, so the folder matches
   * the branch as it does without the pool. A slot in the pool home must never
   * become a session worktree, so a failed move removes it and its new branch.
   */
  private async move(slot: { path: string; branch: string }): Promise<{ path: string; branch: string } | undefined> {
    const target = path.join(this.deps.local, this.deps.folder(slot.branch))
    const error = fs.existsSync(target)
      ? new Error(`${target} already exists`)
      : await this.raw(["worktree", "move", slot.path, target]).then(
          () => undefined,
          (err: unknown) => err,
        )
    if (!error) return { path: target, branch: slot.branch }
    this.deps.log(`worktree pool: move failed, discarding ${slot.path}: ${error}`)
    // A device check cannot see every mount layout, for example two bind
    // mounts of one disk. Stop pre-warming this project for the session.
    if (/cross-device/i.test(String(error))) this.place = Promise.resolve(undefined)
    await this.removePath(slot.path)
    await this.deleteBranch(slot.branch)
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

  /**
   * Adopt leftover pooled slots from a previous run and discard broken ones.
   * Never creates `.kilo/worktrees/`, and removes it when older versions left
   * only their slots there.
   */
  async reconcile(): Promise<void> {
    await this.deps.lock(async () => {
      await this.adopt()
      await this.tidy()
    })
    this.sweep()
  }

  /** Remove every idle slot, used when the feature is turned off in settings. */
  async dispose(): Promise<void> {
    await this.deps.lock(async () => {
      const slots = this.slots
      this.slots = []
      for (const slot of slots) await this.removePath(slot.path)
    })
    this.sweep()
  }

  /** Forget a slot so the normal removal path can clean it up. */
  release(wtPath: string): void {
    this.slots = this.slots.filter((slot) => normalizePath(slot.path) !== normalizePath(wtPath))
  }

  /** Clean slots of every repository in the pool home, once per process and pool state. */
  private sweep(): void {
    const home = this.deps.home
    if (!home) return
    const enabled = this.enabled()
    const key = `${home}\0${enabled}`
    if (WorktreePool.swept.has(key)) return
    WorktreePool.swept.add(key)
    void sweep(home, enabled, this.deps.client, this.deps.log).catch((err: unknown) =>
      this.deps.log(`worktree pool: sweep failed: ${err}`),
    )
  }

  /**
   * Remove a `.kilo/worktrees/` that holds no worktree, for example after the
   * slot of an older version was removed, so the project is clean again.
   * The git lock covers this extension host only, so only the marker file is
   * deleted and the directories are removed with `rmdir`, which fails as soon
   * as another process puts a worktree there.
   */
  private async tidy(): Promise<void> {
    const dir = this.deps.local
    // A missing directory is the normal case.
    const names = await fs.promises.readdir(dir).catch(() => undefined)
    if (!names || names.some((name) => name !== MARKER)) return
    const quiet = (err: NodeJS.ErrnoException) => ["ENOENT", "ENOTEMPTY", "EEXIST"].includes(err.code ?? "")
    const remove = (target: string) =>
      fs.promises.rmdir(target).then(
        () => true,
        (err: NodeJS.ErrnoException) => {
          if (!quiet(err)) this.deps.log(`worktree pool: remove ${target}: ${err}`)
          return false
        },
      )
    const marker = path.join(dir, MARKER)
    await fs.promises
      .rm(marker, { force: true })
      .catch((err) => this.deps.log(`worktree pool: remove ${marker}: ${err}`))
    if (!(await remove(dir))) return
    this.deps.log(`worktree pool: removed empty ${dir}`)
    // `.kilo/` usually holds project config, so only an empty one is removed.
    await remove(path.dirname(dir))
  }

  private async fill(point: PoolStart, oid: string): Promise<void> {
    if (this.size() <= 0) return
    const dir = await this.dir()
    if (!dir) return
    await fs.promises.mkdir(dir, { recursive: true })

    await this.prune()
    await this.retarget(point, oid)
    const missing = this.size() - this.slots.length
    if (missing <= 0) return

    // A claim can reuse the slot name for the branch and its folder in
    // `.kilo/worktrees/`, so avoid names that are taken in any slot directory.
    const names = (await Promise.all(this.dirs.map(subdirs))).flat()
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

    // A session worktree that still looks pooled would be removed by a later
    // reconcile, so a failed write fails the claim.
    const cleared = await this.attempt(() => this.clearMeta(slot.path), `clear metadata ${slot.path}`)
    if (!cleared) {
      await this.discard(slot)
      await this.deleteBranch(branch)
      return undefined
    }
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
    const active = this.size() > 0 ? await this.dir() : undefined
    for (const dir of this.dirs) await this.collect(dir, dir === active)
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
      // Slots are always detached. A branch means a claim that was interrupted
      // before it cleared the metadata, so this is a session worktree.
      if (await this.attached(slotPath)) {
        this.deps.log(`worktree pool: ${slotPath} has a branch checked out, keeping it`)
        continue
      }
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
    if (!file) throw new Error(`git directory not found for ${wtPath}`)
    await fs.promises.writeFile(file, "{}", "utf-8")
  }

  /** True when the worktree has a branch checked out. Reads HEAD directly to avoid a git process. */
  private async attached(wtPath: string): Promise<boolean> {
    const dir = await this.attemptValue(() => this.deps.gitdir(wtPath), `resolve gitdir ${wtPath}`)
    if (!dir) return false
    // A missing HEAD leaves nothing git can check out, so it counts as detached.
    const head = await fs.promises.readFile(path.join(dir, "HEAD"), "utf-8").catch(() => "")
    return head.startsWith("ref:")
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
