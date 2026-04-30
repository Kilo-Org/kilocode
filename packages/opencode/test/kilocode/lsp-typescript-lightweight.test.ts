// Tests for the lightweight TypeScript diagnostic mode.
// These are regression guards — if an upstream OpenCode merge overwrites the
// kilocode integration in shared LSP files, these tests catch it.

import { describe, test, expect, spyOn, afterEach } from "bun:test"
import path from "path"
import { LSPServer } from "../../src/lsp"
import { TsClient } from "../../src/kilocode/ts-client"
import { TsCheck } from "../../src/kilocode/ts-check"
import { Flag } from "../../src/flag/flag"
import { Instance, type InstanceContext } from "../../src/project/instance"

afterEach(async () => {
  await Instance.disposeAll()
})

// Typescript.spawn doesn't use ctx, so a cast-through is fine for these tests.
const fakeCtx = {} as InstanceContext

describe("typescript lightweight mode", () => {
  describe("spawn gate", () => {
    test("Typescript.spawn returns undefined when flag is off", async () => {
      const saved = Flag.KILO_EXPERIMENTAL_LSP_TOOL
      Flag.KILO_EXPERIMENTAL_LSP_TOOL = false
      try {
        const result = await LSPServer.Typescript.spawn("/tmp/any", fakeCtx)
        expect(result).toBeUndefined()
      } finally {
        Flag.KILO_EXPERIMENTAL_LSP_TOOL = saved
      }
    })

    test("Typescript.spawn calls native_tsgo when flag is on", async () => {
      const saved = Flag.KILO_EXPERIMENTAL_LSP_TOOL
      Flag.KILO_EXPERIMENTAL_LSP_TOOL = true
      const spy = spyOn(TsCheck, "native_tsgo").mockResolvedValue(undefined)

      try {
        const result = await LSPServer.Typescript.spawn("/tmp/any", fakeCtx)
        expect(spy).toHaveBeenCalled()
        expect(result).toBeUndefined() // undefined because mock returns no binary
      } finally {
        Flag.KILO_EXPERIMENTAL_LSP_TOOL = saved
        spy.mockRestore()
      }
    })
  })

  describe("TsClient", () => {
    test("create returns a valid LSPClient.Info", () => {
      const client = TsClient.create({ root: "/tmp/test" })
      expect(client.serverID).toBe("typescript")
      expect(client.root).toBe("/tmp/test")
      expect(client.diagnostics).toBeInstanceOf(Map)
      expect(typeof client.shutdown).toBe("function")
      expect(typeof client.waitForDiagnostics).toBe("function")
      expect(typeof client.notify.open).toBe("function")
    })

    test("connection.sendRequest rejects with descriptive error", async () => {
      const client = TsClient.create({ root: "/tmp/test" })
      await expect(client.connection.sendRequest("anything")).rejects.toThrow("lightweight diagnostic mode")
    })

    test("shutdown clears diagnostics", async () => {
      const client = TsClient.create({ root: "/tmp/test" })
      await client.shutdown()
      expect(client.diagnostics.size).toBe(0)
    })
  })

  describe("source integration guards", () => {
    // These tests verify that kilocode integration code exists in shared
    // files. If an upstream merge strips the integration blocks, these fail.

    test("lsp/server.ts gates Typescript.spawn behind flag", async () => {
      const src = await Bun.file(path.resolve(import.meta.dir, "../../src/lsp/server.ts")).text()
      expect(src).toContain("KILO_EXPERIMENTAL_LSP_TOOL")
      expect(src).toContain("native_tsgo")
    })

    test("lsp/lsp.ts uses TsClient for lightweight diagnostics", async () => {
      const src = await Bun.file(path.resolve(import.meta.dir, "../../src/lsp/lsp.ts")).text()
      expect(src).toContain("TsClient.create")
      expect(src).toContain("KILO_EXPERIMENTAL_LSP_TOOL")
    })
  })
})
