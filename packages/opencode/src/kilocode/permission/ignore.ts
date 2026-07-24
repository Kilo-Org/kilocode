import { constants, type BigIntStats } from "node:fs"
import { lstat, open, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import ignore from "ignore"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import * as Log from "@opencode-ai/core/util/log"
import type { InstanceContext } from "@/project/instance-context"
import { KilocodePaths } from "@/kilocode/paths"

const log = Log.create({ service: "kilocode.permission.ignore" })
const name = ".kilocodeignore"
const MAX_BYTES = 1024 * 1024

export namespace IgnorePermission {
  export type Access = "read" | "edit"

  export type Candidate = {
    requested: string
    target?: string
    directory?: boolean
  }

  const failure = (err: unknown) => (err instanceof Error ? err : new Error(String(err)))
  const same = (left: BigIntStats, right: BigIntStats) => left.dev === right.dev && left.ino === right.ino

  export function root(ctx: InstanceContext) {
    return path.resolve(ctx.worktree === "/" ? ctx.directory : ctx.worktree)
  }

  export function files(root: string, dirs: readonly string[] = KilocodePaths.globalDirs()) {
    return [...dirs.map((dir) => path.join(dir, name)), path.join(root, name)]
  }

  export function access(permission: string): Access | undefined {
    if (permission === "read" || permission === "notebook_read" || permission === "notebook_execute") return "read"
    if (permission === "edit" || permission === "write" || permission === "notebook_edit") return "edit"
  }

  function relative(root: string, filepath: string, directory: boolean) {
    const value = path.relative(root, filepath)
    if (!value || value === "." || path.isAbsolute(value) || value === ".." || value.startsWith(`..${path.sep}`)) return
    const result = value.replaceAll("\\", "/")
    return directory ? `${result}/` : result
  }

  export function matches(input: { root: string; filepath: string; contents: readonly string[]; directory?: boolean }) {
    const target = relative(input.root, input.filepath, input.directory ?? false)
    if (!target) return false
    const matcher = ignore()
    for (const content of input.contents) matcher.add(content)
    return matcher.ignores(target)
  }

  export async function physical(filepath: string) {
    const parts: string[] = []
    let current = path.resolve(filepath)
    while (true) {
      try {
        return path.join(await realpath(current), ...parts)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code !== "ENOENT" && code !== "ENOTDIR") throw err
        const parent = path.dirname(current)
        if (parent === current) throw err
        parts.unshift(path.basename(current))
        current = parent
      }
    }
  }

  async function directory(filepath: string) {
    try {
      return (await stat(filepath)).isDirectory()
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === "ENOENT" || code === "ENOTDIR") return false
      throw err
    }
  }

  async function load(filepath: string) {
    let before: BigIntStats
    try {
      before = await lstat(filepath, { bigint: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return
      throw err
    }
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new Error(`.kilocodeignore must be a regular file: ${filepath}`)
    }
    if (before.size > MAX_BYTES) throw new Error(`.kilocodeignore exceeds ${MAX_BYTES} bytes: ${filepath}`)

    const flags =
      process.platform === "win32"
        ? constants.O_RDONLY | constants.O_NONBLOCK
        : constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW
    const file = await open(filepath, flags)
    try {
      const opened = await file.stat({ bigint: true })
      if (!opened.isFile() || !same(before, opened)) {
        throw new Error(`.kilocodeignore changed while loading: ${filepath}`)
      }
      const data = Buffer.allocUnsafe(MAX_BYTES + 1)
      const result = await file.read(data, 0, data.length, 0)
      if (result.bytesRead > MAX_BYTES) throw new Error(`.kilocodeignore exceeds ${MAX_BYTES} bytes: ${filepath}`)
      return new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(0, result.bytesRead))
    } finally {
      await file.close()
    }
  }

  export function candidates(ctx: InstanceContext, patterns: readonly string[]): Candidate[] {
    const base = ctx.worktree === "/" ? ctx.directory : ctx.worktree
    return patterns.map((pattern) => ({
      requested: path.isAbsolute(pattern) ? path.resolve(pattern) : path.resolve(base, pattern),
    }))
  }

  async function check(input: { ctx: InstanceContext; candidates: readonly Candidate[]; dirs?: readonly string[] }) {
    const root = IgnorePermission.root(input.ctx)
    const canonicalRoot = await physical(root)
    const contents = await Promise.all(IgnorePermission.files(root, input.dirs).map(load))
    const policies = contents.filter((content): content is string => content !== undefined)
    if (policies.length === 0) return false

    for (const candidate of input.candidates) {
      const requested = path.resolve(candidate.requested)
      const target = candidate.target ? path.resolve(candidate.target) : await physical(requested)
      const paths = [
        { root, filepath: requested },
        { root: canonicalRoot, filepath: target },
      ]
      for (const item of paths) {
        if (
          matches({
            root: item.root,
            filepath: item.filepath,
            contents: policies,
            directory: candidate.directory ?? (await directory(item.filepath)),
          })
        ) {
          return true
        }
      }
    }

    return false
  }

  export async function fingerprint(ctx: InstanceContext, dirs?: readonly string[]) {
    const root = IgnorePermission.root(ctx)
    try {
      const contents = await Promise.all(IgnorePermission.files(root, dirs).map(load))
      return new Bun.CryptoHasher("sha256").update(JSON.stringify(contents)).digest("hex")
    } catch (err) {
      log.warn("failed to load .kilocodeignore", { err: failure(err) })
      return "invalid"
    }
  }

  function denied(permission: string) {
    return new PermissionV1.DeniedError({
      ruleset: [{ permission, pattern: name, action: "deny" }],
    })
  }

  export async function allowed(input: {
    ctx: InstanceContext
    access: Access
    candidates: readonly Candidate[]
    dirs?: readonly string[]
  }) {
    try {
      return !(await check(input))
    } catch (err) {
      log.warn("failed to load .kilocodeignore", { err: failure(err) })
      return false
    }
  }

  export const assert = Effect.fn("IgnorePermission.assert")(function* (input: {
    ctx: InstanceContext
    permission?: string
    access?: Access
    patterns?: readonly string[]
    candidates?: readonly Candidate[]
    dirs?: readonly string[]
  }) {
    const access = input.access ?? (input.permission ? IgnorePermission.access(input.permission) : undefined)
    if (!access) return
    const candidates = input.candidates ?? IgnorePermission.candidates(input.ctx, input.patterns ?? [])
    if (candidates.length === 0) return
    const allowed = yield* Effect.tryPromise({
      try: () => IgnorePermission.allowed({ ctx: input.ctx, access, candidates, dirs: input.dirs }),
      catch: failure,
    }).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!allowed) return yield* denied(input.permission ?? access)
  })
}
