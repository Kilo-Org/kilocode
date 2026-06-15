import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Deferred, Effect, Layer } from "effect"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LSP } from "@/lsp/lsp"
import * as LSPServer from "@/lsp/server"
import * as launch from "../../src/lsp/launch" // kilocode_change - spy on spawn
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTestInstance, provideTmpdirInstance, tmpdir } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"
import { type InstanceContext } from "../../src/project/instance-context"
import { Flag } from "@opencode-ai/core/flag/flag" // kilocode_change
import { TsCheck } from "../../src/kilocode/ts-check" // kilocode_change

// kilocode_change - Typescript.spawn ignores ctx, so a cast is fine here.
const fakeCtx = {} as InstanceContext
const fakeFlags = {} as RuntimeFlags.Info

const it = testEffect(Layer.mergeAll(LSP.defaultLayer, CrossSpawnSpawner.defaultLayer))
const experimentalTyIt = testEffect(
  Layer.mergeAll(
    LSP.layer.pipe(Layer.provide(Config.defaultLayer), Layer.provide(RuntimeFlags.layer({ experimentalLspTy: true }))),
    CrossSpawnSpawner.defaultLayer,
  ),
)
const fakeServerPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
const disabledDownloadIt = testEffect(
  Layer.mergeAll(
    LSP.layer.pipe(Layer.provide(Config.defaultLayer), Layer.provide(RuntimeFlags.layer({ disableLspDownload: true }))),
    CrossSpawnSpawner.defaultLayer,
  ),
)

describe("lsp.spawn", () => {
  it.live("does not spawn builtin LSP for files outside instance", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

            try {
              yield* lsp.touchFile(path.join(dir, "..", "outside.ts"))
              yield* lsp.hover({
                file: path.join(dir, "..", "hover.ts"),
                line: 0,
                character: 0,
              })
              expect(spy).toHaveBeenCalledTimes(0)
            } finally {
              spy.mockRestore()
            }
          }),
        ),
      { config: { lsp: true } },
    ),
  )

  it.live("does not spawn builtin LSP for files inside instance when LSP is unset", () =>
    provideTmpdirInstance((dir) =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.ts"),
              line: 0,
              character: 0,
            })
            expect(spy).toHaveBeenCalledTimes(0)
          } finally {
            spy.mockRestore()
          }
        }),
      ),
    ),
  )

  // kilocode_change start - provide the runtime flag so spawn() is reached past the TsClient short-circuit
  const experimentalToolIt = testEffect(
    Layer.mergeAll(
      LSP.layer.pipe(
        Layer.provide(Config.defaultLayer),
        Layer.provide(RuntimeFlags.layer({ experimentalLspTool: true })),
      ),
      CrossSpawnSpawner.defaultLayer,
    ),
  )

  experimentalToolIt.live("would spawn builtin LSP for files inside instance when lsp is true", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

            try {
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.ts"),
                line: 0,
                character: 0,
              })
              expect(spy).toHaveBeenCalledTimes(1)
            } finally {
              spy.mockRestore()
            }
          }),
        ),
      { config: { lsp: true } },
    ),
  )

  it.live("publishes lsp.updated after custom LSP initialization", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const lsp = yield* LSP.Service
          const updated = yield* Deferred.make<void>()
          const unsubscribe = Bus.subscribe(LSP.Event.Updated, () =>
            Effect.runSync(Deferred.succeed(updated, undefined)),
          )
          yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))

          const file = path.join(dir, "sample.repro")
          yield* Effect.promise(() => Bun.write(file, "sample\n"))
          yield* lsp.touchFile(file)
          yield* awaitWithTimeout(Deferred.await(updated), "lsp.updated event was not published")
        }),
      {
        config: {
          lsp: {
            fake: {
              command: [process.execPath, fakeServerPath],
              extensions: [".repro"],
            },
          },
        },
      },
    ),
  )

  experimentalToolIt.live("would spawn builtin LSP for files inside instance when config object is provided", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

            try {
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.ts"),
                line: 0,
                character: 0,
              })
              expect(spy).toHaveBeenCalledTimes(1)
            } finally {
              spy.mockRestore()
            }
          }),
        ),
      {
        config: {
          lsp: {
            eslint: { disabled: true },
          },
        },
      },
    ),
  )
  // kilocode_change end

  // kilocode_change start - Typescript spawn is gated behind KILO_EXPERIMENTAL_LSP_TOOL.
  test("spawns tsgo LSP when KILO_EXPERIMENTAL_LSP_TOOL is enabled", async () => {
    const saved = Flag.KILO_EXPERIMENTAL_LSP_TOOL
    Flag.KILO_EXPERIMENTAL_LSP_TOOL = true
    await using tmp = await tmpdir()

    const spawnSpy = spyOn(launch, "spawn").mockImplementation(
      () => ({ stdin: {}, stdout: {}, stderr: {}, on: () => {}, kill: () => {} }) as any,
    )
    const tsgoSpy = spyOn(TsCheck, "native_tsgo").mockResolvedValue("/fake/tsgo")

    try {
      await provideTestInstance({
        directory: tmp.path,
        fn: async () => {
          const result = await LSPServer.Typescript.spawn(tmp.path, fakeCtx, fakeFlags)
          expect(result).toBeDefined()
          expect(tsgoSpy).toHaveBeenCalledWith(tmp.path)
          expect(spawnSpy).toHaveBeenCalled()
          const args = spawnSpy.mock.calls[0][1] as string[]
          expect(args).toContain("--lsp")
          expect(args).toContain("--stdio")
        },
      })
    } finally {
      Flag.KILO_EXPERIMENTAL_LSP_TOOL = saved
      spawnSpy.mockRestore()
      tsgoSpy.mockRestore()
    }
  })

  test("Typescript.spawn returns undefined when KILO_EXPERIMENTAL_LSP_TOOL is off", async () => {
    const saved = Flag.KILO_EXPERIMENTAL_LSP_TOOL
    Flag.KILO_EXPERIMENTAL_LSP_TOOL = false
    try {
      const result = await LSPServer.Typescript.spawn("/tmp/any", fakeCtx, fakeFlags)
      expect(result).toBeUndefined()
    } finally {
      Flag.KILO_EXPERIMENTAL_LSP_TOOL = saved
    }
  })
  // kilocode_change end
  it.live("uses pyright instead of ty by default", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const ty = spyOn(LSPServer.Ty, "spawn").mockResolvedValue(undefined)
            const pyright = spyOn(LSPServer.Pyright, "spawn").mockResolvedValue(undefined)

            try {
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.py"),
                line: 0,
                character: 0,
              })
              expect(ty).toHaveBeenCalledTimes(0)
              expect(pyright).toHaveBeenCalledTimes(1)
            } finally {
              ty.mockRestore()
              pyright.mockRestore()
            }
          }),
        ),
      { config: { lsp: true } },
    ),
  )

  experimentalTyIt.live("uses ty instead of pyright when experimentalLspTy is enabled", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const ty = spyOn(LSPServer.Ty, "spawn").mockResolvedValue(undefined)
            const pyright = spyOn(LSPServer.Pyright, "spawn").mockResolvedValue(undefined)

            try {
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.py"),
                line: 0,
                character: 0,
              })
              expect(ty).toHaveBeenCalledTimes(1)
              expect(pyright).toHaveBeenCalledTimes(0)
            } finally {
              ty.mockRestore()
              pyright.mockRestore()
            }
          }),
        ),
      { config: { lsp: true } },
    ),
  )

  disabledDownloadIt.live("passes disableLspDownload to builtin LSP spawn", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const pyright = spyOn(LSPServer.Pyright, "spawn").mockResolvedValue(undefined)

            try {
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.py"),
                line: 0,
                character: 0,
              })
              expect(pyright).toHaveBeenCalledTimes(1)
              expect(pyright.mock.calls[0]?.[2]).toMatchObject({ disableLspDownload: true })
            } finally {
              pyright.mockRestore()
            }
          }),
        ),
      { config: { lsp: true } },
    ),
  )
})
