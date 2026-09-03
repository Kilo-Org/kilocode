import { constants, type BigIntStats } from "node:fs"
import { open, realpath, stat, type FileHandle } from "node:fs/promises"
import { Readable } from "node:stream"
import { Effect } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"

export namespace KiloReadObject {
  export class ChangedError extends Error {}

  export type FileInfo = {
    requested: string
    target: string
    stat: BigIntStats
  }

  export type File = FileInfo & {
    handle: FileHandle
    read: (limit?: number, signal?: AbortSignal) => Promise<Buffer>
    sample: (limit: number, signal?: AbortSignal) => Promise<Buffer>
    stream: (signal?: AbortSignal) => Readable
  }

  const failure = (err: unknown) => (err instanceof Error ? err : new Error(String(err)))
  const same = (left: BigIntStats, right: BigIntStats) => left.dev === right.dev && left.ino === right.ino
  const normalize = (input: string) => (process.platform === "win32" ? FSUtil.normalizePath(input) : input)

  export function namedPipe(input: string) {
    return (
      /^\\\\[.?]\\pipe\\/i.test(input) ||
      /^\\\\[^\\]+\\pipe\\/i.test(input) ||
      /^\\\\\?\\GLOBALROOT\\Device\\NamedPipe\\/i.test(input)
    )
  }

  async function inspect(requested: string) {
    if (process.platform === "win32" && namedPipe(requested)) {
      throw new ChangedError(`Named pipes cannot be read: ${requested}`)
    }
    const opened = await stat(requested, { bigint: true })
    const resolved = await realpath(requested)
    const seen = await stat(resolved, { bigint: true })
    if (!same(opened, seen)) throw new ChangedError(`Path changed while inspecting: ${requested}`)
    return { requested, target: normalize(resolved), stat: opened }
  }

  export const file = Effect.fn("KiloReadObject.file")(function* (requested: string) {
    const info = yield* Effect.tryPromise({ try: () => inspect(requested), catch: failure })
    if (!info.stat.isFile()) return yield* Effect.fail(new ChangedError(`Not a regular file: ${requested}`))
    return info satisfies FileInfo
  })

  async function bytes(handle: FileHandle, limit?: number, signal?: AbortSignal) {
    const chunks: Buffer[] = []
    const size = 64 * 1024
    const cap = limit === undefined ? Number.MAX_SAFE_INTEGER : limit
    let offset = 0
    while (offset < cap) {
      signal?.throwIfAborted()
      const buffer = Buffer.allocUnsafe(Math.min(size, cap - offset))
      const result = await handle.read(buffer, 0, buffer.length, offset)
      if (result.bytesRead === 0) break
      chunks.push(buffer.subarray(0, result.bytesRead))
      offset += result.bytesRead
    }
    return Buffer.concat(chunks, offset)
  }

  async function* chunks(handle: FileHandle, signal?: AbortSignal) {
    const size = 64 * 1024
    let offset = 0
    while (true) {
      signal?.throwIfAborted()
      const buffer = Buffer.allocUnsafe(size)
      const result = await handle.read(buffer, 0, buffer.length, offset)
      if (result.bytesRead === 0) return
      offset += result.bytesRead
      yield buffer.subarray(0, result.bytesRead)
    }
  }

  export function use<A, E, R>(info: FileInfo, fn: (file: File) => Effect.Effect<A, E, R>) {
    const flags =
      process.platform === "win32"
        ? constants.O_RDONLY
        : constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW
    const streams = new Set<Readable>()
    const acquire = Effect.tryPromise({
      try: () => open(info.target, flags),
      catch: failure,
    })
    return Effect.acquireUseRelease(
      acquire,
      (handle) =>
        Effect.gen(function* () {
          const opened = yield* Effect.tryPromise({
            try: () => handle.stat({ bigint: true }),
            catch: failure,
          })
          if (!opened.isFile() || !same(info.stat, opened)) {
            return yield* Effect.fail(new ChangedError(`File changed after authorization: ${info.requested}`))
          }
          const probe = process.platform === "linux" ? `/proc/self/fd/${handle.fd}` : info.target
          const resolved = yield* Effect.tryPromise({ try: () => realpath(probe), catch: failure })
          const seen = yield* Effect.tryPromise({
            try: () => stat(resolved, { bigint: true }),
            catch: failure,
          })
          if (!same(opened, seen) || normalize(resolved) !== info.target) {
            return yield* Effect.fail(new ChangedError(`File changed after authorization: ${info.requested}`))
          }
          return yield* fn({
            ...info,
            handle,
            read: (limit, signal) => bytes(handle, limit, signal),
            sample: (limit, signal) => bytes(handle, limit, signal),
            stream: (signal) => {
              const stream = Readable.from(chunks(handle, signal))
              streams.add(stream)
              stream.once("close", () => streams.delete(stream))
              return stream
            },
          })
        }),
      (handle) =>
        Effect.tryPromise({
          try: async () => {
            await Promise.all(
              [...streams].map(
                (stream) =>
                  new Promise<void>((resolve) => {
                    if (stream.closed) return resolve()
                    stream.once("close", resolve)
                    stream.destroy()
                  }),
              ),
            )
            await handle.close()
          },
          catch: failure,
        }),
    )
  }
}
