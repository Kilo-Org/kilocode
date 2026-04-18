import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import * as Lsp from "../../src/lsp/index"
import * as launch from "../../src/lsp/launch"
import { LSPServer } from "../../src/lsp/server"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Flag } from "../../src/flag/flag" // kilocode_change
import { TsCheck } from "../../src/kilocode/ts-check" // kilocode_change

describe("lsp.spawn", () => {
  test("does not spawn builtin LSP for files outside instance", async () => {
    await using tmp = await tmpdir()
    const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Lsp.LSP.touchFile(path.join(tmp.path, "..", "outside.ts"))
          await Lsp.LSP.hover({
            file: path.join(tmp.path, "..", "hover.ts"),
            line: 0,
            character: 0,
          })
        },
      })

      expect(spy).toHaveBeenCalledTimes(0)
    } finally {
      spy.mockRestore()
      await Instance.disposeAll()
    }
  })

  // kilocode_change start - enable flag so spawn() is actually reached (lightweight mode skips it)
  test("would spawn builtin LSP for files inside instance", async () => {
    const saved = Flag.KILO_EXPERIMENTAL_LSP_TOOL
    // @ts-expect-error - override static flag for test
    Flag.KILO_EXPERIMENTAL_LSP_TOOL = true
    await using tmp = await tmpdir()
    const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Lsp.LSP.hover({
            file: path.join(tmp.path, "src", "inside.ts"),
            line: 0,
            character: 0,
          })
        },
      })

      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      // @ts-expect-error
      Flag.KILO_EXPERIMENTAL_LSP_TOOL = saved
      spy.mockRestore()
      await Instance.disposeAll()
    }
  })
  // kilocode_change end

  // kilocode_change start - Typescript spawn is gated behind KILO_EXPERIMENTAL_LSP_TOOL.
  // When the flag is off (default), spawn() returns undefined immediately (lightweight
  // TsClient mode). These tests verify the experimental tsgo LSP spawn path.
  test("spawns tsgo LSP when KILO_EXPERIMENTAL_LSP_TOOL is enabled", async () => {
    const saved = Flag.KILO_EXPERIMENTAL_LSP_TOOL
    // @ts-expect-error - override static flag for test
    Flag.KILO_EXPERIMENTAL_LSP_TOOL = true
    await using tmp = await tmpdir()

    const spawnSpy = spyOn(launch, "spawn").mockImplementation(
      () => ({ stdin: {}, stdout: {}, stderr: {}, on: () => {}, kill: () => {} }) as any,
    )
    const tsgoSpy = spyOn(TsCheck, "native_tsgo").mockResolvedValue("/fake/tsgo")

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await LSPServer.Typescript.spawn(tmp.path)
          expect(result).toBeDefined()
          expect(tsgoSpy).toHaveBeenCalledWith(tmp.path)
          expect(spawnSpy).toHaveBeenCalled()
          const args = spawnSpy.mock.calls[0][1] as string[]
          expect(args).toContain("--lsp")
          expect(args).toContain("--stdio")
        },
      })
    } finally {
      // @ts-expect-error
      Flag.KILO_EXPERIMENTAL_LSP_TOOL = saved
      spawnSpy.mockRestore()
      tsgoSpy.mockRestore()
    }
  })

  test("Typescript.spawn returns undefined when KILO_EXPERIMENTAL_LSP_TOOL is off", async () => {
    const saved = Flag.KILO_EXPERIMENTAL_LSP_TOOL
    // @ts-expect-error
    Flag.KILO_EXPERIMENTAL_LSP_TOOL = false
    try {
      const result = await LSPServer.Typescript.spawn("/tmp/any")
      expect(result).toBeUndefined()
    } finally {
      // @ts-expect-error
      Flag.KILO_EXPERIMENTAL_LSP_TOOL = saved
    }
  })
  // kilocode_change end
})
