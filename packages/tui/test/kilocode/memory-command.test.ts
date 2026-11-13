import { describe, expect, test } from "bun:test"
import type { KiloMemoryRpc } from "@opencode/schema/kilocode/memory"
import { runMemoryCommand, type MemoryRpc } from "../../src/kilocode/memory-command"

const state: KiloMemoryRpc.State = {
  version: 1,
  enabled: true,
  scope: "project",
  autoInject: true,
  autoConsolidate: true,
  verbose: false,
  capture: { mode: "selective", turnClose: true, explicit: true, maxOpsPerRun: 3, minIntervalMs: 0, timeoutMs: 1000 },
  limits: {
    maxProjectIndexBytes: 1,
    maxSessionFiles: 1,
    maxRecentSessions: 1,
    maxConsolidationInputBytes: 1,
    maxLineChars: 1,
    maxSessionLineChars: 1,
  },
  stats: {
    lastInjectedAt: null,
    lastInjectedBytes: 0,
    lastInjectedTokens: 0,
    lastInjectedSessionID: null,
    lastTypedConsolidationAt: null,
    lastSessionSavedAt: null,
    lastConsolidatedMessageID: null,
    lastConsolidationCost: 0,
    lastConsolidationTokens: 0,
    lastOperationCount: 0,
    lastRecallAt: null,
    lastRecallCount: 0,
    lastRecallSessionID: null,
  },
}
const index = { text: "", bytes: 0, tokens: 1234, truncated: false }
const operation = (input: Partial<KiloMemoryRpc.Operation> = {}): KiloMemoryRpc.Operation => ({
  operationCount: 1,
  added: 1,
  removed: 0,
  skipped: [],
  index,
  ...input,
})

function harness(input: { enabled?: boolean; fail?: string } = {}) {
  const calls: Array<{ method: string; input: unknown; directory: string | undefined }> = []
  const toasts: Array<{ message: string; variant: string }> = []
  const opened: string[] = []
  const ui: string[] = []
  const record =
    <T>(method: string, output: T) =>
    async (value: unknown, options?: { location?: { directory?: string } }) => {
      calls.push({ method, input: value, directory: options?.location?.directory })
      if (input.fail) throw { type: "memory_storage_error", message: input.fail }
      return output
    }
  const root = "/home/user/.kilo/memory/project"
  const rpc: MemoryRpc = {
    status: record("status", {
      root,
      state: { ...state, enabled: input.enabled ?? true },
      exists: { state: true, index: true },
      index: { bytes: 0, estimatedTokens: 0, preview: "" },
    }),
    show: record("show", {
      root,
      state,
      sources: { project: "", environment: "", corrections: "" },
      index: "",
      items: "",
    }),
    enable: record("enable", { root, state, index }),
    disable: record("disable", { root, state: { ...state, enabled: false } }),
    configure: record("configure", { root, state: { ...state, autoConsolidate: false } }),
    rebuild: record("rebuild", { root, state, index }),
    remember: record("remember", operation({ operationCount: 2 })),
    correct: record("correct", operation()),
    forget: record("forget", operation({ removed: 3 })),
    purge: record("purge", { root, purged: true }),
  }
  const run = (text: string, sessionID?: string) =>
    runMemoryCommand({
      text,
      rpc,
      directory: "/repo",
      sessionID,
      toast: { show: (toast) => toasts.push(toast) },
      inspect: (path) => {
        opened.push(path)
      },
      show: () => ui.push("show"),
      status: () => ui.push("status"),
      usage: (reason) => ui.push(`usage:${reason ?? ""}`),
    })
  return { run, calls, toasts, opened, ui, root }
}

describe("runMemoryCommand", () => {
  test("ignores text that is not a memory command", async () => {
    const app = harness()
    expect(await app.run("remember to run tests")).toBe(false)
    expect(app.calls).toEqual([])
  })

  test("opens the help, show, status and usage dialogs without RPC calls", async () => {
    const app = harness()
    expect(await app.run("/memory")).toBe(true)
    expect(await app.run("/mem show")).toBe(true)
    expect(await app.run("/memory status")).toBe(true)
    expect(await app.run("/memory remember")).toBe(true)
    expect(app.ui).toEqual(["usage:", "show", "status", "usage:Missing text."])
    expect(app.calls).toEqual([])
  })

  test("enables, disables and configures memory in the requested directory", async () => {
    const app = harness()
    await app.run("/memory on")
    await app.run("/memory off")
    await app.run("/memory auto off")
    expect(app.calls).toEqual([
      { method: "enable", input: {}, directory: "/repo" },
      { method: "disable", input: {}, directory: "/repo" },
      { method: "configure", input: { autoConsolidate: false }, directory: "/repo" },
    ])
    expect(app.toasts).toEqual([
      { variant: "success", message: "Memory enabled" },
      { variant: "info", message: "Memory disabled" },
      { variant: "info", message: "Memory auto-save off" },
    ])
  })

  test("saves, corrects and forgets with the session and reports the change counts", async () => {
    const app = harness()
    await app.run("/memory remember the test command is bun test", "ses_1")
    await app.run("/memory correct use bun, not npm")
    await app.run("/memory forget npm", "ses_1")
    expect(app.calls).toEqual([
      { method: "remember", input: { sessionID: "ses_1", text: "the test command is bun test" }, directory: "/repo" },
      { method: "correct", input: { text: "use bun, not npm" }, directory: "/repo" },
      { method: "forget", input: { sessionID: "ses_1", query: "npm" }, directory: "/repo" },
    ])
    expect(app.toasts.map((toast) => toast.message)).toEqual([
      "Memory saved · 2 changes",
      "Correction saved · 1 change",
      "Memory updated · 3 removed",
    ])
  })

  test("rebuilds and purges with confirmation", async () => {
    const app = harness()
    await app.run("/memory rebuild")
    await app.run("/memory purge")
    await app.run("/memory purge confirm")
    expect(app.calls.map((call) => [call.method, call.input])).toEqual([
      ["rebuild", {}],
      ["purge", { confirm: true }],
    ])
    expect(app.toasts.map((toast) => toast.message)).toEqual(["Memory rebuilt (1,234 memory tokens)", "Memory purged"])
    expect(app.ui).toEqual(["usage:Purge requires confirmation. Run /memory purge confirm."])
  })

  test("inspect opens the memory folder only when memory is enabled", async () => {
    const enabled = harness()
    await enabled.run("/memory inspect")
    expect(enabled.opened).toEqual([enabled.root])
    expect(enabled.toasts).toEqual([{ variant: "info", message: `Memory folder: ${enabled.root}` }])

    const disabled = harness({ enabled: false })
    await disabled.run("/memory inspect")
    expect(disabled.opened).toEqual([])
    expect(disabled.toasts).toEqual([
      { variant: "error", message: "Memory command failed: Memory is disabled. Run /memory on first." },
    ])
  })

  test("shows the RPC error message when an operation fails", async () => {
    const app = harness({ fail: "Memory storage failed" })
    expect(await app.run("/memory remember x")).toBe(true)
    expect(app.toasts).toEqual([{ variant: "error", message: "Memory command failed: Memory storage failed" }])
  })
})
