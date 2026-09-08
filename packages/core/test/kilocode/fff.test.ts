import { describe, expect, test } from "bun:test"
import { FileFinder, type InitOptions } from "@ff-labs/fff-bun"
import "@opencode-ai/core/filesystem"
import { Fff } from "@opencode-ai/core/filesystem/fff.bun"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import fs from "node:fs/promises"
import path from "path"
import { Cause, Context, Effect, Layer, Scope } from "effect"
import { allowed, message, notices } from "@opencode-ai/core/kilocode/fff"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"

describe("FFF scanning boundaries", () => {
  test.each(["/", "/workspace/..", "C:\\", "D:/", "\\\\server\\share\\", "\\\\?\\C:\\", "\\\\?\\UNC\\server\\share\\"])(
    "blocks filesystem root %s",
    (directory) => expect(allowed(directory)).toBe(false),
  )

  test("blocks broad scans and warns for home/root aliases without blocking scoped file tools", async () => {
    await using tmp = await tmpdir()
    const home = process.env.KILO_TEST_HOME
    const disabled = Flag.KILO_DISABLE_FFF
    const create = FileFinder.create
    const calls = { native: 0, walk: 0 }
    const root = path.parse(tmp.path).root
    const project = path.join(tmp.path, "project")
    const alias = path.join(tmp.path, "alias")
    const link = path.join(tmp.path, "root")
    const kind = process.platform === "win32" ? "junction" : "dir"
    await fs.mkdir(project)
    await fs.writeFile(path.join(project, "file.ts"), "needle\n")
    await fs.symlink(tmp.path, alias, kind)
    await fs.symlink(root, link, kind)
    process.env.KILO_TEST_HOME = tmp.path
    FileFinder.create = () => {
      calls.native++
      return { ok: false, error: "unexpected native index" }
    }
    try {
      expect(allowed(project)).toBe(true)
      expect(notices(project)).toEqual([])
      await Effect.runPromise(
        Effect.gen(function* () {
          const { FileSystemSearch } = yield* Effect.promise(() => import("@opencode-ai/core/filesystem/search"))
          const native = yield* Ripgrep.Service
          const source = FileSystemSearch.locationLayer.pipe(
            Layer.provide(
              Layer.succeed(Ripgrep.Service, {
                ...native,
                find: () => Effect.sync(() => (calls.walk++, [])),
              }),
            ),
            Layer.provide(FSUtil.defaultLayer),
          )
          for (const value of [false, true]) {
            Flag.KILO_DISABLE_FFF = value
            for (const directory of [root, tmp.path, alias, link]) {
              expect(allowed(directory)).toBe(false)
              expect(notices(directory)).toEqual([{ path: directory, message }])
              const context = yield* Layer.build(
                source.pipe(
                  Layer.provide(
                    Layer.succeed(
                      Location.Service,
                      Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
                    ),
                  ),
                  Layer.fresh,
                ),
              )
              yield* Effect.yieldNow
              const service = Context.get(context, FileSystemSearch.Service)
              expect(yield* service.find({ query: "file" })).toEqual([])
              if (directory !== tmp.path) continue
              const path = RelativePath.make("project")
              expect((yield* service.glob({ pattern: "*.ts", path })).map((item) => item.path)).toHaveLength(1)
              expect((yield* service.grep({ pattern: "needle", path })).map((item) => item.text)).toEqual(["needle\n"])
            }
          }
          expect(calls).toEqual({ native: 0, walk: 0 })
          yield* Effect.promise(() => fs.unlink(alias).then(() => fs.symlink(project, alias, kind)))
          const context = yield* Layer.build(
            FileSystemSearch.fffLayer.pipe(
              Layer.provide(FSUtil.defaultLayer),
              Layer.provide(
                Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(alias) }))),
              ),
            ),
          )
          const service = Context.get(context, FileSystemSearch.Service)
          for (const directory of [root, tmp.path]) {
            yield* Effect.promise(() => fs.unlink(alias).then(() => fs.symlink(directory, alias, kind)))
            for (const request of [
              service.find({ query: "" }).pipe(Effect.asVoid),
              service.glob({ pattern: "*" }).pipe(Effect.asVoid),
              service.grep({ pattern: "needle" }).pipe(Effect.asVoid),
            ]) {
              const result = yield* Effect.exit(request)
              expect(result._tag).toBe("Failure")
              if (result._tag === "Failure") expect(Cause.pretty(result.cause)).toContain(message)
            }
          }
          expect(calls).toEqual({ native: 0, walk: 0 })
        }).pipe(Effect.provide(LayerNode.compile(Ripgrep.node)), Effect.scoped),
      )
    } finally {
      FileFinder.create = create
      Flag.KILO_DISABLE_FFF = disabled
      if (home === undefined) delete process.env.KILO_TEST_HOME
      if (home !== undefined) process.env.KILO_TEST_HOME = home
    }
  })
})

describe("FFF lifecycle", () => {
  test("retries a failed first search and reuses one picker", async () => {
    if (!Fff.available()) return

    const dir = await tmpdir()
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
              expect(calls.opts).not.toHaveProperty("enableHomeDirScanning")

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
