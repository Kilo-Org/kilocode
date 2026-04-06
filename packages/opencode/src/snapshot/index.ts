import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { Flag } from "../flag/flag"
import { Global } from "../global"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Scheduler } from "../scheduler"
import * as KiloSnapshot from "../kilocode/snapshot" // kilocode_change
import { Lock } from "../util/lock" // kilocode_change

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })
  const hour = 60 * 60 * 1000
  const prune = "7.days"
  export const MAX_DIFF_SIZE = 256 * 1024 // kilocode_change
  const MAX_SNAPSHOT_FILE_SIZE = 2 * 1024 * 1024 // kilocode_change — skip files >2MB during snapshot add

  export function init() {
    Scheduler.register({
      id: "snapshot.cleanup",
      interval: hour,
      run: cleanup,
      scope: "instance",
    })
  }

  export async function cleanup() {
    if (Instance.project.vcs !== "git" || Flag.KILO_CLIENT === "acp") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    const exists = await fs
      .stat(git)
      .then(() => true)
      .catch(() => false)
    if (!exists) return
    using _lock = await Lock.write(git) // kilocode_change
    const result =
      await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true --git-dir ${git} --work-tree ${Instance.worktree} gc --prune=${prune}`
        .quiet()
        .cwd(Instance.directory)
        .nothrow()
    if (result.exitCode !== 0) {
      log.warn("cleanup failed", {
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return
    }
    log.info("cleanup", { prune })
  }

  export async function track() {
    if (Instance.project.vcs !== "git" || Flag.KILO_CLIENT === "acp") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = await KiloSnapshot.prepare() // kilocode_change
    using _lock = await Lock.write(git) // kilocode_change
    await add(git)
    const hash = await $`git --git-dir ${git} --work-tree ${Instance.worktree} write-tree`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .text()
    log.info("tracking", { hash, cwd: Instance.directory, git })
    return hash.trim()
  }

  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
  })
  export type Patch = z.infer<typeof Patch>

  export async function patch(hash: string): Promise<Patch> {
    const git = await KiloSnapshot.prepare() // kilocode_change
    using _lock = await Lock.write(git) // kilocode_change
    await add(git)
    const result =
      await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --name-only ${hash} -- .`
        .quiet()
        .cwd(Instance.directory)
        .nothrow()

    // If git diff fails, return empty patch
    if (result.exitCode !== 0) {
      log.warn("failed to get diff", { hash, exitCode: result.exitCode })
      return { hash, files: [] }
    }

    const files = result.text()
    return {
      hash,
      files: files
        .trim()
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => path.join(Instance.worktree, x).replaceAll("\\", "/")),
    }
  }

  export async function restore(snapshot: string) {
    log.info("restore", { commit: snapshot })
    const git = await KiloSnapshot.prepare() // kilocode_change
    using _lock = await Lock.write(git) // kilocode_change
    const result =
      await $`git -c core.longpaths=true -c core.symlinks=true --git-dir ${git} --work-tree ${Instance.worktree} read-tree ${snapshot} && git -c core.longpaths=true -c core.symlinks=true --git-dir ${git} --work-tree ${Instance.worktree} checkout-index -a -f`
        .quiet()
        .cwd(Instance.worktree)
        .nothrow()

    if (result.exitCode !== 0) {
      log.error("failed to restore snapshot", {
        snapshot,
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
    }
  }

  // kilocode_change start — batched revert: group up to 100 files per git checkout (port of upstream #20564)
  type RevertOp = { hash: string; file: string; rel: string }

  /** Revert a single file: checkout from snapshot or delete if it didn't exist. */
  async function revertSingle(git: string, worktree: string, op: RevertOp) {
    log.info("reverting", { file: op.file, hash: op.hash })
    const result =
      await $`git -c core.longpaths=true -c core.symlinks=true --git-dir ${git} --work-tree ${worktree} checkout ${op.hash} -- ${op.file}`
        .quiet()
        .cwd(worktree)
        .nothrow()
    if (result.exitCode === 0) return
    const tree =
      await $`git -c core.longpaths=true -c core.symlinks=true --git-dir ${git} --work-tree ${worktree} ls-tree ${op.hash} -- ${op.rel}`
        .quiet()
        .cwd(worktree)
        .nothrow()
    if (tree.exitCode === 0 && tree.text().trim()) {
      log.info("file existed in snapshot but checkout failed, keeping", { file: op.file, hash: op.hash })
      return
    }
    log.info("file did not exist in snapshot, deleting", { file: op.file, hash: op.hash })
    await fs.unlink(op.file).catch(() => {})
  }

  /** Revert a batch of files sharing the same hash. Falls back to single-file on failure. */
  async function revertBatch(git: string, worktree: string, batch: RevertOp[]) {
    const hash = batch[0]!.hash

    // Check which files exist in the snapshot
    const tree =
      await $`git -c core.longpaths=true -c core.symlinks=true -c core.quotepath=false --git-dir ${git} --work-tree ${worktree} ls-tree --name-only ${hash} -- ${batch.map((op) => op.rel)}`
        .quiet()
        .cwd(worktree)
        .nothrow()

    if (tree.exitCode !== 0) {
      log.info("batched ls-tree failed, falling back to single-file revert", { hash, files: batch.length })
      for (const op of batch) await revertSingle(git, worktree, op)
      return
    }

    const existing = new Set(tree.text().trim().split("\n").map((l) => l.trim()).filter(Boolean))

    // Checkout files that exist in the snapshot
    const toCheckout = batch.filter((op) => existing.has(op.rel))
    if (toCheckout.length) {
      log.info("reverting", { hash, files: toCheckout.length })
      const result =
        await $`git -c core.longpaths=true -c core.symlinks=true --git-dir ${git} --work-tree ${worktree} checkout ${hash} -- ${toCheckout.map((op) => op.file)}`
          .quiet()
          .cwd(worktree)
          .nothrow()
      if (result.exitCode !== 0) {
        log.info("batched checkout failed, falling back to single-file revert", { hash, files: toCheckout.length })
        for (const op of batch) await revertSingle(git, worktree, op)
        return
      }
    }

    // Delete files that didn't exist in the snapshot
    for (const op of batch) {
      if (existing.has(op.rel)) continue
      log.info("file did not exist in snapshot, deleting", { file: op.file, hash: op.hash })
      await fs.unlink(op.file).catch(() => {})
    }
  }

  /** True when one path is a parent of the other (e.g. "a/b" and "a/b/c"). */
  function pathsClash(a: string, b: string) {
    return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
  }

  /** Can this op be added to the current batch? */
  function canBatch(batch: RevertOp[], op: RevertOp): boolean {
    if (batch.length >= 100) return false
    if (op.hash !== batch[0]!.hash) return false
    if (batch.some((existing) => pathsClash(existing.rel, op.rel))) return false
    return true
  }

  /**
   * Group consecutive ops into batches that share the same hash,
   * have no path conflicts, and contain at most 100 files each.
   */
  function groupIntoBatches(ops: RevertOp[]): RevertOp[][] {
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

  export async function revert(patches: Patch[]) {
    const git = await KiloSnapshot.prepare() // kilocode_change
    using _lock = await Lock.write(git) // kilocode_change
    const worktree = Instance.worktree

    // Deduplicate files preserving patch order
    const ops: RevertOp[] = []
    const seen = new Set<string>()
    for (const item of patches) {
      for (const file of item.files) {
        if (seen.has(file)) continue
        seen.add(file)
        ops.push({ hash: item.hash, file, rel: path.relative(worktree, file).replaceAll("\\", "/") })
      }
    }

    for (const batch of groupIntoBatches(ops)) {
      if (batch.length === 1) {
        await revertSingle(git, worktree, batch[0]!)
      } else {
        await revertBatch(git, worktree, batch)
      }
    }
  }
  // kilocode_change end

  export async function diff(hash: string) {
    const git = await KiloSnapshot.prepare() // kilocode_change
    using _lock = await Lock.write(git) // kilocode_change
    await add(git)
    const result =
      await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff ${hash} -- .`
        .quiet()
        .cwd(Instance.worktree)
        .nothrow()

    if (result.exitCode !== 0) {
      log.warn("failed to get diff", {
        hash,
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return ""
    }

    return result.text().trim()
  }

  export const FileDiff = z
    .object({
      file: z.string(),
      before: z.string(),
      after: z.string(),
      additions: z.number(),
      deletions: z.number(),
      status: z.enum(["added", "deleted", "modified"]).optional(),
    })
    .meta({
      ref: "FileDiff",
    })
  export type FileDiff = z.infer<typeof FileDiff>

  // kilocode_change start — cache diffFull results to prevent redundant git spawning (#8379)
  const diffCache = new Map<string, Promise<FileDiff[]>>()
  const DIFF_CACHE_MAX = 100

  export async function diffFull(from: string, to: string): Promise<FileDiff[]> {
    if (from === to) return []
    const key = `${from}:${to}`
    const cached = diffCache.get(key)
    if (cached) return cached
    if (diffCache.size >= DIFF_CACHE_MAX) {
      const first = diffCache.keys().next().value
      if (first) diffCache.delete(first)
    }
    const pending = diffFullUncached(from, to).catch((err) => {
      diffCache.delete(key)
      throw err
    })
    diffCache.set(key, pending)
    return pending
  }
  // kilocode_change end

  async function diffFullUncached(from: string, to: string): Promise<FileDiff[]> {
    const git = await KiloSnapshot.prepare() // kilocode_change
    using _lock = await Lock.write(git) // kilocode_change
    const result: FileDiff[] = []
    const status = new Map<string, "added" | "deleted" | "modified">()

    const statuses =
      await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --name-status --no-renames ${from} ${to} -- .`
        .quiet()
        .cwd(Instance.directory)
        .nothrow()
        .text()

    for (const line of statuses.trim().split("\n")) {
      if (!line) continue
      const [code, file] = line.split("\t")
      if (!code || !file) continue
      const kind = code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified"
      status.set(file, kind)
    }

    for await (const line of $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --no-renames --numstat ${from} ${to} -- .`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .lines()) {
      if (!line) continue
      const [additions, deletions, file] = line.split("\t")
      const isBinaryFile = additions === "-" && deletions === "-"
      // kilocode_change start
      const oversized =
        !isBinaryFile &&
        ((parseInt(await $`git --git-dir ${git} cat-file -s ${from}:${file}`.quiet().nothrow().text()) || 0) >
          MAX_DIFF_SIZE ||
          (parseInt(await $`git --git-dir ${git} cat-file -s ${to}:${file}`.quiet().nothrow().text()) || 0) >
            MAX_DIFF_SIZE)
      const skip = isBinaryFile || oversized
      // kilocode_change end
      const before = skip
        ? ""
        : await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true --git-dir ${git} --work-tree ${Instance.worktree} show ${from}:${file}`
            .quiet()
            .nothrow()
            .text()
      const after = skip
        ? ""
        : await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true --git-dir ${git} --work-tree ${Instance.worktree} show ${to}:${file}`
            .quiet()
            .nothrow()
            .text()
      const added = isBinaryFile ? 0 : parseInt(additions)
      const deleted = isBinaryFile ? 0 : parseInt(deletions)
      result.push({
        file,
        before,
        after,
        additions: Number.isFinite(added) ? added : 0,
        deletions: Number.isFinite(deleted) ? deleted : 0,
        status: status.get(file) ?? "modified",
      })
    }
    return result
  }

  function gitdir() {
    return KiloSnapshot.gitdir() // kilocode_change
  }

  // kilocode_change start — incremental add: diff-files + ls-files + size filter (port of upstream #17878)
  async function add(git: string) {
    const cwd = Instance.directory
    const worktree = Instance.worktree

    // Run diff-files and ls-files concurrently to find changed + untracked files
    const [diffResult, otherResult] = await Promise.all([
      $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true -c core.quotepath=false --git-dir ${git} --work-tree ${worktree} diff-files --name-only -z -- .`
        .quiet()
        .cwd(cwd)
        .nothrow(),
      $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true -c core.quotepath=false --git-dir ${git} --work-tree ${worktree} ls-files --others --exclude-standard -z -- .`
        .quiet()
        .cwd(cwd)
        .nothrow(),
    ])

    if (diffResult.exitCode !== 0 || otherResult.exitCode !== 0) {
      log.warn("failed to list snapshot files", {
        diffCode: diffResult.exitCode,
        diffStderr: diffResult.stderr.toString(),
        otherCode: otherResult.exitCode,
        otherStderr: otherResult.stderr.toString(),
      })
      return
    }

    const tracked = diffResult.text().split("\0").filter(Boolean)
    const all = Array.from(new Set([...tracked, ...otherResult.text().split("\0").filter(Boolean)]))
    if (!all.length) {
      await syncExclude(git)
      return
    }

    // Filter out oversized files (>2MB)
    const large = (
      await Promise.all(
        all.map(async (item) => {
          const stat = await fs.stat(path.join(cwd, item)).catch(() => null)
          return stat?.isFile() && stat.size > MAX_SNAPSHOT_FILE_SIZE ? item : undefined
        }),
      )
    ).filter(Boolean) as string[]

    await syncExclude(git, large)
    await $`git -c core.autocrlf=false -c core.longpaths=true -c core.symlinks=true --git-dir ${git} --work-tree ${worktree} add --sparse .`
      .quiet()
      .cwd(cwd)
      .nothrow()
  }

  async function syncExclude(git: string, largeFiles: string[] = []) {
    const file = await excludes()
    const target = path.join(git, "info", "exclude")
    await fs.mkdir(path.join(git, "info"), { recursive: true })
    const parts: string[] = []
    if (file) {
      const text = await Filesystem.readText(file).catch(() => "")
      if (text.trim()) parts.push(text.trimEnd())
    }
    for (const item of largeFiles) {
      parts.push(`/${item.replaceAll("\\", "/")}`)
    }
    await Filesystem.write(target, parts.length ? parts.join("\n") + "\n" : "")
  }
  // kilocode_change end

  async function excludes() {
    const file = await $`git rev-parse --path-format=absolute --git-path info/exclude`
      .quiet()
      .cwd(Instance.worktree)
      .nothrow()
      .text()
    if (!file.trim()) return
    const exists = await fs
      .stat(file.trim())
      .then(() => true)
      .catch(() => false)
    if (!exists) return
    return file.trim()
  }
}
