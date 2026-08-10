import { describe, expect, test } from "bun:test"
import { FileFinder, type InitOptions } from "@ff-labs/fff-bun"
import "@opencode-ai/core/filesystem"
import { Fff } from "@opencode-ai/core/filesystem/fff.bun"
import { FSUtil } from "@opencode-ai/core/fs-util"
import os from "os"
import path from "path"
import { Context, Effect, Layer, Scope } from "effect"
import { scanning } from "@opencode-ai/core/kilocode/fff"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"

describe("FFF scanning boundaries", () => {
  test("enables filesystem-root scanning only at the exact root", () => {
    const root = path.parse(process.cwd()).root
    expect(scanning(root)).toEqual({ enableFsRootScanning: true, enableHomeDirScanning: root === os.homedir() })
    expect(scanning(path.join(root, "workspace"))).toEqual({
      enableFsRootScanning: false,
      enableHomeDirScanning: false,
    })
  })

  test("enables home scanning only at the exact home directory", () => {
    const home = os.homedir()
    expect(scanning(home)).toEqual({
      enableFsRootScanning: home === path.parse(home).root,
      enableHomeDirScanning: true,
    })
    expect(scanning(path.join(home, "workspace"))).toEqual({
      enableFsRootScanning: false,
      enableHomeDirScanning: false,
    })
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
