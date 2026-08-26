import { describe, expect, test } from "bun:test"
import { FileFinder, type InitOptions } from "@ff-labs/fff-bun"
import "@opencode-ai/core/filesystem"
import { Fff } from "@opencode-ai/core/filesystem/fff.bun"
import { FSUtil } from "@opencode-ai/core/fs-util"
import fs from "node:fs/promises"
import os from "os"
import path from "path"
import { Cause, Context, Effect, Layer, Scope } from "effect"
import { allowed, scanning } from "@opencode-ai/core/kilocode/fff"
import { Location } from "@opencode-ai/core/location"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"

describe("FFF scanning boundaries", () => {
  test("rejects POSIX, Windows drive, and UNC roots", () => {
    expect(allowed("/")).toBe(false)
    expect(allowed("C:\\")).toBe(false)
    expect(allowed("D:/")).toBe(false)
    expect(allowed("\\\\server\\share\\")).toBe(false)
    expect(allowed("\\\\?\\C:\\workspace\\..")).toBe(false)
    expect(allowed("\\\\?\\UNC\\server\\share\\")).toBe(false)
  })

  test("allows ordinary project directories", () => {
    expect(allowed("/workspace")).toBe(true)
    expect(allowed("C:\\workspace")).toBe(true)
    expect(allowed("D:/workspace")).toBe(true)
    expect(allowed("\\\\server\\share\\workspace")).toBe(true)
  })

  test("keeps explicit home scanning without opting into filesystem-root scanning", () => {
    expect(scanning(os.homedir())).toEqual({ enableHomeDirScanning: true })
    expect(scanning(path.join(os.homedir(), "workspace"))).toEqual({ enableHomeDirScanning: false })
    expect(scanning(os.homedir())).not.toHaveProperty("enableFsRootScanning")
  })

  test("does not start FFF or fallback indexing at a filesystem root", async () => {
    const root = path.parse(process.cwd()).root
    const tmp = process.platform === "win32" ? undefined : await tmpdir()
    const link = tmp ? path.join(tmp.path, "root") : undefined
    if (link) await fs.symlink(root, link)
    const create = FileFinder.create
    const calls = { fff: 0, ripgrep: 0 }
    FileFinder.create = () => {
      calls.fff++
      return { ok: false, error: "FFF must not start at a filesystem root" }
    }
    const ripgrep = Layer.succeed(
      Ripgrep.Service,
      Ripgrep.Service.of({
        find: () =>
          Effect.sync(() => {
            calls.ripgrep++
            return []
          }),
        glob: () => Effect.succeed({ items: [], truncated: false, partial: false }),
        grep: () => Effect.succeed({ items: [], truncated: false, partial: false }),
      }),
    )

    try {
      for (const directory of [root, link].filter((item): item is string => item !== undefined)) {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const { FileSystemSearch } = yield* Effect.promise(() => import("@opencode-ai/core/filesystem/search"))
              const layer = FileSystemSearch.locationLayer.pipe(
                Layer.provide(FSUtil.defaultLayer),
                Layer.provide(ripgrep),
                Layer.provide(
                  Layer.succeed(
                    Location.Service,
                    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
                  ),
                ),
              )
              const context = yield* Layer.build(layer)
              const service = Context.get(context, FileSystemSearch.Service)
              expect(yield* service.find({ query: "", type: "file", limit: 1 })).toEqual([])
            }),
          ),
        )
      }
      expect(calls).toEqual({ fff: 0, ripgrep: 0 })
    } finally {
      FileFinder.create = create
      await tmp?.[Symbol.asyncDispose]()
    }
  })
})

describe("FFF lifecycle", () => {
  test("rechecks a changed symlink before creating a picker and retries with the canonical path", async () => {
    await using tmp = await tmpdir()
    const project = path.join(tmp.path, "project")
    const link = path.join(tmp.path, "link")
    const type = process.platform === "win32" ? "junction" : "dir"
    await fs.mkdir(project)
    await fs.symlink(project, link, type)
    const create = FileFinder.create
    const calls: InitOptions[] = []
    FileFinder.create = (opts) => {
      calls.push(opts)
      return { ok: false, error: "native creation intercepted" }
    }

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { FileSystemSearch } = yield* Effect.promise(() => import("@opencode-ai/core/filesystem/search"))
            const layer = FileSystemSearch.fffLayer.pipe(
              Layer.provide(FSUtil.defaultLayer),
              Layer.provide(
                Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(link) }))),
              ),
            )
            const context = yield* Layer.build(layer)
            const service = Context.get(context, FileSystemSearch.Service)
            expect(calls).toEqual([])
            yield* Effect.promise(async () => {
              await fs.unlink(link)
              await fs.symlink(path.parse(project).root, link, type)
            })

            for (const effect of [
              service.find({ query: "", type: "file", limit: 1 }).pipe(Effect.asVoid),
              service.glob({ pattern: "*", limit: 1 }).pipe(Effect.asVoid),
              service.grep({ pattern: "needle", limit: 1 }).pipe(Effect.asVoid),
            ]) {
              const result = yield* Effect.exit(effect)
              expect(result._tag).toBe("Failure")
              if (result._tag === "Failure") {
                expect(Cause.pretty(result.cause)).toContain("FFF indexing is disabled for filesystem roots.")
              }
            }
            expect(calls).toEqual([])

            yield* Effect.promise(async () => {
              await fs.unlink(link)
              await fs.symlink(project, link, type)
            })
            yield* Effect.exit(service.find({ query: "", type: "file", limit: 1 }))
            expect(calls).toHaveLength(1)
            expect(calls[0].basePath).toBe(project)
          }),
        ),
      )
    } finally {
      FileFinder.create = create
    }
  })

  test("retries a failed first search and reuses one picker", async () => {
    if (!Fff.available()) return

    const dir = await tmpdir()
    expect(allowed(dir.path)).toBe(true)
    const create = FileFinder.create
    const calls = { create: 0, destroy: 0, opts: undefined as InitOptions | undefined }
    try {
      FileFinder.create = (opts) => {
        calls.create++
        if (calls.create === 1) return { ok: false, error: "transient failure" }
        calls.opts = opts
        const result = create(opts)
        if (!result.ok) return result
        const destroy = result.value.destroy.bind(result.value)
        result.value.destroy = () => {
          calls.destroy++
          destroy()
        }
        return result
      }

      await Effect.runPromise(
        Effect.acquireUseRelease(
          Scope.make(),
          (scope) =>
            Effect.gen(function* () {
              const { FileSystemSearch } = yield* Effect.promise(() => import("@opencode-ai/core/filesystem/search"))
              const layer = FileSystemSearch.fffLayer.pipe(
                Layer.provide(FSUtil.defaultLayer),
                Layer.provide(
                  Layer.succeed(
                    Location.Service,
                    Location.Service.of(
                      location(
                        { directory: AbsolutePath.make(dir.path) },
                        { vcs: { type: "git", store: AbsolutePath.make(path.join(dir.path, ".git")) } },
                      ),
                    ),
                  ),
                ),
              )
              const context = yield* Layer.buildWithScope(layer, scope)
              const service = Context.get(context, FileSystemSearch.Service)
              expect(calls.create).toBe(0)

              const first = yield* Effect.exit(
                Effect.all(
                  [
                    service.find({ query: "", type: "file", limit: 1 }),
                    service.find({ query: "", type: "file", limit: 1 }),
                  ],
                  { concurrency: "unbounded" },
                ),
              )
              expect(first._tag).toBe("Failure")
              expect(calls.create).toBe(1)

              yield* service.find({ query: "", type: "file", limit: 1 })
              expect(calls.create).toBe(2)
              expect(calls.opts?.disableMmapCache).toBe(true)
              expect(calls.opts?.disableContentIndexing).toBe(true)
              expect(calls.opts).not.toHaveProperty("enableFsRootScanning")
              expect(calls.opts?.enableHomeDirScanning).toBe(false)

              yield* service.find({ query: "", type: "file", limit: 1 })
              expect(calls.create).toBe(2)
              expect(calls.destroy).toBe(0)
            }),
          (scope, exit) => Scope.close(scope, exit),
        ),
      )
      expect(calls.destroy).toBe(1)
    } finally {
      FileFinder.create = create
      await dir[Symbol.asyncDispose]()
    }
  })
})
