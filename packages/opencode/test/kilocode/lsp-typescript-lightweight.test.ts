// Tests for the lightweight TypeScript diagnostic mode.
// These are regression guards — if an upstream OpenCode merge overwrites the
// kilocode integration in shared LSP files, these tests catch it.

import { describe, test, expect, spyOn, afterEach } from "bun:test"
import path from "path"
import { utimes } from "node:fs/promises"
import { DiagnosticSeverity } from "vscode-languageserver-types"
import * as LSPServer from "../../src/lsp/server"
import { TsClient } from "../../src/kilocode/ts-client"
import { TsCheck } from "../../src/kilocode/ts-check"
import { GlobalBus } from "../../src/bus/global"
import type { LSPClient } from "../../src/lsp/client"
import { withTimeout } from "../../src/util/timeout"
import { Flag } from "@opencode-ai/core/flag/flag"
import type { InstanceContext } from "../../src/kilocode/instance"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import type { RuntimeFlags } from "../../src/effect/runtime-flags"

afterEach(async () => {
  await disposeAllInstances()
})

// Typescript.spawn doesn't use ctx, so a cast-through is fine for these tests.
const fakeCtx = {} as InstanceContext
const fakeFlags = {} as RuntimeFlags.Info

const diag: LSPClient.Diagnostic = {
  severity: DiagnosticSeverity.Error,
  message: "broken",
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
}

function checker(root: string, ctx?: InstanceContext) {
  const signals = new Map<number, ReturnType<typeof Promise.withResolvers<void>>>()
  const calls: Array<{
    signal?: AbortSignal
    result: ReturnType<typeof Promise.withResolvers<Map<string, LSPClient.Diagnostic[]> | undefined>>
  }> = []
  const spy = spyOn(TsCheck, "run").mockImplementation((_root, signal) => {
    const result = Promise.withResolvers<Map<string, LSPClient.Diagnostic[]> | undefined>()
    calls.push({ signal, result })
    signals.get(calls.length - 1)?.resolve()
    return result.promise
  })
  const client = TsClient.create({ root, ctx })
  return {
    client,
    calls,
    started(index: number) {
      if (calls.at(index)) return Promise.resolve()
      const signal = Promise.withResolvers<void>()
      signals.set(index, signal)
      return withTimeout(signal.promise, 1_000, "checker did not start")
    },
    async finish(index: number, result?: Map<string, LSPClient.Diagnostic[]>) {
      calls.at(index)!.result.resolve(result)
      // Drain the resolved check and its cleanup, without a timing-based sleep.
      await new Promise<void>((resolve) => setImmediate(resolve))
    },
    async [Symbol.asyncDispose]() {
      const stopped = client.shutdown()
      for (const call of calls) call.result.resolve(undefined)
      await stopped
      spy.mockRestore()
    },
  }
}

function changed(directory: string, file: string, event: "change" | "add" | "unlink" = "change") {
  GlobalBus.emit("event", {
    directory,
    payload: { type: "file.watcher.updated", properties: { file, event } },
  })
}

describe("typescript lightweight mode", () => {
  describe("spawn gate", () => {
    test("Typescript.spawn returns undefined when flag is off", async () => {
      const saved = Flag.KILO_EXPERIMENTAL_LSP_TOOL
      Flag.KILO_EXPERIMENTAL_LSP_TOOL = false
      try {
        const result = await LSPServer.Typescript.spawn("/tmp/any", fakeCtx, fakeFlags)
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
        const result = await LSPServer.Typescript.spawn("/tmp/any", fakeCtx, fakeFlags)
        expect(spy).toHaveBeenCalled()
        expect(result).toBeUndefined() // undefined because mock returns no binary
      } finally {
        Flag.KILO_EXPERIMENTAL_LSP_TOOL = saved
        spy.mockRestore()
      }
    })
  })

  describe("TsClient", () => {
    test("create returns a valid LSPClient.Info", async () => {
      const client = TsClient.create({ root: "/tmp/test" })
      expect(client.serverID).toBe("typescript")
      expect(client.root).toBe("/tmp/test")
      expect(client.diagnostics).toBeInstanceOf(Map)
      expect(typeof client.shutdown).toBe("function")
      expect(typeof client.waitForDiagnostics).toBe("function")
      expect(typeof client.notify.open).toBe("function")
      await client.shutdown()
    })

    test("connection.sendRequest rejects with descriptive error", async () => {
      const client = TsClient.create({ root: "/tmp/test" })
      await expect(client.connection.sendRequest("anything")).rejects.toThrow("lightweight diagnostic mode")
      await client.shutdown()
    })

    test("shutdown clears diagnostics", async () => {
      const client = TsClient.create({ root: "/tmp/test" })
      await client.shutdown()
      expect(client.diagnostics.size).toBe(0)
    })

    test("does not block on the first check or start concurrent checkers for a multi-file patch", async () => {
      await using tmp = await tmpdir()
      const first = path.join(tmp.path, "a.ts")
      const second = path.join(tmp.path, "b.ts")
      for (const file of [first, second]) {
        await Bun.write(file, "export const value = 1\n")
        await utimes(file, 1, 1)
      }
      await using test = checker(tmp.path)
      // Both calls must return before the controlled checker is released.
      await test.client.waitForDiagnostics({ path: first, version: 1 })
      await test.client.waitForDiagnostics({ path: second, version: 1 })
      expect(test.calls).toHaveLength(1)
      await test.finish(
        0,
        new Map([
          [first, [diag]],
          [second, [diag]],
        ]),
      )
      await test.client.waitForDiagnostics({ path: "b.ts", version: 1 })
      expect(test.calls).toHaveLength(1)
      expect(test.client.diagnostics.size).toBe(2)
    })

    test("coalesces parallel writes into one follow-up check without publishing the superseded result", async () => {
      await using tmp = await tmpdir()
      const file = path.join(tmp.path, "a.ts")
      await Bun.write(file, "export const value = 1\n")
      await utimes(file, 1, 1)
      await using test = checker(tmp.path)
      await test.client.waitForDiagnostics({ path: file, version: 1 })
      changed(tmp.path, file)
      changed(tmp.path, path.join(tmp.path, "b.ts"), "add")
      await test.client.waitForDiagnostics({ path: file, version: 2 })
      expect(test.calls).toHaveLength(1)
      await test.finish(0, new Map([[file, [diag]]]))
      expect(test.client.diagnostics.size).toBe(0)
      expect(test.calls).toHaveLength(2)
      await test.finish(1, new Map([[file, [diag]]]))
      await test.client.waitForDiagnostics({ path: file, version: 2 })
      expect(test.calls).toHaveLength(2)
      expect(test.client.diagnostics.get(file)).toEqual([diag])
    })

    test("a delayed notification does not reuse a result from before the write", async () => {
      await using tmp = await tmpdir()
      const file = path.join(tmp.path, "a.ts")
      await Bun.write(file, "export const value = 1\n")
      await utimes(file, 1, 1)
      const clock = spyOn(Date, "now").mockReturnValue(2_000)
      await using test = checker(tmp.path)
      try {
        await test.client.waitForDiagnostics({ path: file, version: 1 })
        // The checker read the old file before a write, then finished later.
        await utimes(file, 2.5, 2.5)
        clock.mockReturnValue(3_000)
        await test.finish(0, new Map([[file, [diag]]]))
        clock.mockReturnValue(4_000)
        const waiting = test.client.waitForDiagnostics({ path: file, version: 2 })
        await test.started(1)
        expect(test.calls).toHaveLength(2)
        expect(test.client.diagnostics.size).toBe(0)
        await test.finish(1, new Map())
        await waiting
        expect(test.client.diagnostics.size).toBe(0)
      } finally {
        clock.mockRestore()
      }
    })

    test("failed checks remain retryable for unchanged files without an automatic retry loop", async () => {
      await using tmp = await tmpdir()
      const file = path.join(tmp.path, "a.ts")
      await Bun.write(file, "export const value = 1\n")
      await utimes(file, 1, 1)
      await using test = checker(tmp.path)
      await test.client.waitForDiagnostics({ path: file, version: 1 })
      await test.finish(0, undefined)
      expect(test.calls).toHaveLength(1)
      const waiting = test.client.waitForDiagnostics({ path: file, version: 1 })
      await test.started(1)
      expect(test.calls).toHaveLength(2)
      await test.finish(1, new Map([[file, [diag]]]))
      await waiting
      expect(test.client.diagnostics.get(file)).toEqual([diag])
    })

    test("move and delete events invalidate old project errors without touching the removed source", async () => {
      await using tmp = await tmpdir()
      const file = path.join(tmp.path, "a.ts")
      await Bun.write(file, "export const value = 1\n")
      await utimes(file, 1, 1)
      await using test = checker(tmp.path)
      await test.client.waitForDiagnostics({ path: file, version: 1 })
      await test.finish(0, new Map([[file, [diag]]]))
      changed("/another/worktree", file, "unlink")
      expect(test.client.diagnostics.has(file)).toBe(true)
      changed(tmp.path, path.join(tmp.path, "tsconfig.tsbuildinfo"))
      expect(test.client.diagnostics.has(file)).toBe(true)
      changed(tmp.path, file, "unlink")
      changed(tmp.path, path.join(tmp.path, "renamed.ts"), "add")
      expect(test.client.diagnostics.size).toBe(0)
      expect(test.calls).toHaveLength(1)
    })

    test("a failed refresh cannot restore old project errors or mark the cache fresh", async () => {
      await using tmp = await tmpdir()
      const file = path.join(tmp.path, "a.ts")
      await Bun.write(file, "export const value = 1\n")
      await utimes(file, 1, 1)
      await using test = checker(tmp.path)
      await test.client.waitForDiagnostics({ path: file, version: 1 })
      await test.finish(0, new Map([[file, [diag]]]))
      changed(tmp.path, file, "unlink")
      const waiting = test.client.waitForDiagnostics({ path: file, version: 2 })
      await test.started(1)
      expect(test.client.diagnostics.size).toBe(0)
      await test.finish(1, undefined)
      await waiting
      const retry = test.client.waitForDiagnostics({ path: file, version: 2 })
      await test.started(2)
      await test.finish(2, new Map())
      await retry
      expect(test.client.diagnostics.size).toBe(0)
    })

    test("shutdown aborts the checker, drops late results, and removes its event listener", async () => {
      await using tmp = await tmpdir()
      const count = GlobalBus.listenerCount("event")
      await using test = checker(tmp.path)
      await test.client.waitForDiagnostics({ path: "a.ts", version: 1 })
      const stopped = test.client.shutdown()
      expect(test.calls.at(0)!.signal?.aborted).toBe(true)
      changed(tmp.path, path.join(tmp.path, "a.ts"))
      await test.finish(0, new Map([[path.join(tmp.path, "a.ts"), [diag]]]))
      await stopped
      await test.client.waitForDiagnostics({ path: "a.ts", version: 2 })
      expect(test.calls).toHaveLength(1)
      expect(test.client.diagnostics.size).toBe(0)
      expect(GlobalBus.listenerCount("event")).toBe(count)
    })

    test("routes invalidations by the supplied instance directory rather than the checker root", async () => {
      await using tmp = await tmpdir()
      const root = path.join(tmp.path, "package")
      const file = path.join(root, "a.ts")
      await Bun.write(file, "export const value = 1\n")
      await utimes(file, 1, 1)
      // The production caller passes ctx after async process/root discovery.
      await Promise.resolve()
      await using test = checker(root, { ...fakeCtx, directory: tmp.path })
      await test.client.waitForDiagnostics({ path: file, version: 1 })
      await test.finish(0, new Map())
      changed(root, file)
      await test.client.waitForDiagnostics({ path: "package/a.ts", version: 1 })
      expect(test.calls).toHaveLength(1)
      changed(tmp.path, file)
      const waiting = test.client.waitForDiagnostics({ path: "package/a.ts", version: 2 })
      await test.started(1)
      await test.finish(1, new Map())
      await waiting
      expect(test.calls).toHaveLength(2)
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
      expect(src).toContain("TsClient.create({ root, ctx })")
      expect(src).toContain("flags.experimentalLspTool")
    })
  })
})
