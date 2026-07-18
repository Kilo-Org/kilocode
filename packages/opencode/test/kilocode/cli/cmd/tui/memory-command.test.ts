import { describe, expect, test } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2"
import { memoryRow } from "@/kilocode/cli/cmd/tui/component/memory-status"
import { runMemoryCommand } from "@/kilocode/cli/cmd/tui/memory-command"
import { MemoryTuiEvents } from "@/kilocode/cli/cmd/tui/memory-events"
import { MemoryTuiMeta } from "@/kilocode/cli/cmd/tui/memory-meta"
import { MemoryTuiState } from "@/kilocode/cli/cmd/tui/memory-state"

type Handler = (event: {
  properties: { sessionID?: string; detail?: unknown; reason?: string }
}) => void | Promise<void>

describe("memory TUI command parser", () => {
  test("manual mutation toasts match server event wording", async () => {
    const shown: string[] = []
    const calls: unknown[] = []
    const result = {
      data: {
        operationCount: 1,
        removed: 1,
        index: { tokens: 1234 },
      },
    }
    const client = {
      memory: {
        remember: async (input: unknown) => {
          calls.push(input)
          return result
        },
        correct: async (input: unknown) => {
          calls.push(input)
          return result
        },
        forget: async (input: unknown) => {
          calls.push(input)
          return result
        },
      },
    } as unknown as KiloClient
    const base = {
      client,
      toast: {
        show(input: { message: string }) {
          shown.push(input.message)
        },
      },
      show() {},
      status() {},
      usage() {},
      sessionID: "ses_tui_memory",
    }

    await runMemoryCommand({ ...base, text: "/memory remember tests run from packages/opencode" })
    await runMemoryCommand({ ...base, text: "/memory correct old test command is wrong" })
    await runMemoryCommand({ ...base, text: "/memory forget old test command" })

    expect(shown).toEqual(["Memory saved · 1 change", "Correction saved · 1 change", "Memory updated · 1 removed"])
    expect(shown.join("\n")).not.toContain("1,234")
    expect(shown.join("\n")).not.toContain("memory tokens")
    expect(calls).toEqual([
      { sessionID: "ses_tui_memory", text: "tests run from packages/opencode" },
      { sessionID: "ses_tui_memory", text: "old test command is wrong" },
      { sessionID: "ses_tui_memory", query: "old test command" },
    ])
  })

  test("auto-save, verbose, and purge commands call explicit endpoints", async () => {
    const shown: string[] = []
    const calls: unknown[] = []
    const state = { autoConsolidate: true, verbose: false }
    const client = {
      memory: {
        status: async () => ({ data: { state } }),
        configure: async (input: unknown) => {
          calls.push(input)
          return { data: { state: { autoConsolidate: false, verbose: true } } }
        },
        purge: async (input: unknown) => {
          calls.push(input)
          return { data: { purged: true } }
        },
      },
    } as unknown as KiloClient
    const base = {
      client,
      toast: {
        show(input: { message: string }) {
          shown.push(input.message)
        },
      },
      show() {},
      status() {},
      usage(message: string) {
        shown.push(message)
      },
    }

    await runMemoryCommand({ ...base, text: "/memory auto off" })
    await runMemoryCommand({ ...base, text: "/memory verbose on" })
    await runMemoryCommand({ ...base, text: "/memory auto status" })
    await runMemoryCommand({ ...base, text: "/memory purge" })
    await runMemoryCommand({ ...base, text: "/memory purge confirm" })

    expect(shown[0]).toBe("Memory auto-save off")
    expect(shown[1]).toBe("Memory verbose on")
    expect(shown[2]).toContain("Missing auto mode")
    expect(shown[3]).toContain("Purge requires confirmation")
    expect(shown[4]).toBe("Memory purged")
    expect(calls).toEqual([{ autoConsolidate: false }, { verbose: true }, { confirm: true }])
  })

  test("status opens overview dialog", async () => {
    const shown: string[] = []
    const opened: string[] = []
    const client = { memory: {} } as unknown as KiloClient

    await runMemoryCommand({
      text: "/memory status",
      client,
      toast: {
        show(input: { message: string }) {
          shown.push(input.message)
        },
      },
      show() {},
      status() {
        opened.push("status")
      },
      usage() {},
    })

    expect(opened).toEqual(["status"])
    expect(shown).toEqual([])
  })

  test("bare memory command opens help", async () => {
    const calls: unknown[] = []
    const client = { memory: {} } as unknown as KiloClient

    const result = await runMemoryCommand({
      text: "/memory",
      client,
      toast: { show() {} },
      show() {
        calls.push("show")
      },
      status() {
        calls.push("status")
      },
      usage(message?: string) {
        calls.push(message)
      },
    })

    expect(result).toBe(true)
    expect(calls).toEqual([undefined])
  })

  test("on and off call enable and disable endpoints", async () => {
    const shown: string[] = []
    const calls: string[] = []
    const client = {
      memory: {
        enable: async () => {
          calls.push("enable")
          return { data: { root: "/tmp/kilo-data/memory/repo-abc123", index: { tokens: 42 } } }
        },
        disable: async () => {
          calls.push("disable")
          return { data: { state: { enabled: false } } }
        },
      },
    } as unknown as KiloClient

    await runMemoryCommand({
      text: "/memory on",
      client,
      toast: {
        show(input: { message: string }) {
          shown.push(input.message)
        },
      },
      show() {},
      status() {},
      usage() {},
    })
    await runMemoryCommand({
      text: "/memory off",
      client,
      toast: {
        show(input: { message: string }) {
          shown.push(input.message)
        },
      },
      show() {},
      status() {},
      usage() {},
    })

    expect(calls).toEqual(["enable", "disable"])
    expect(shown[0]).toBe("Memory enabled")
    expect(shown[1]).toBe("Memory disabled")
  })

  test("memory commands route to session directory when no workspace is active", async () => {
    const calls: unknown[] = []
    const state = { autoConsolidate: false, verbose: false }
    const client = {
      memory: {
        configure: async (input: unknown) => {
          calls.push(input)
          return { data: { state } }
        },
      },
    } as unknown as KiloClient
    const base = {
      client,
      toast: { show() {} },
      show() {},
      status() {},
      usage() {},
    }

    await runMemoryCommand({ ...base, text: "/memory auto off", directory: "/repo/packages/opencode" })
    await runMemoryCommand({ ...base, text: "/memory verbose on", directory: "/repo/packages/opencode" })
    await runMemoryCommand({
      ...base,
      text: "/memory auto off",
      workspace: "wrk_123",
      directory: "/repo/packages/opencode",
    })

    expect(calls).toEqual([
      { directory: "/repo/packages/opencode", autoConsolidate: false },
      { directory: "/repo/packages/opencode", verbose: true },
      { workspace: "wrk_123", autoConsolidate: false },
    ])
  })
})

describe("memory TUI events", () => {
  test("subscribes only to memory errors", () => {
    const handlers: Record<string, Handler[]> = {}
    MemoryTuiEvents.attach({
      sessionID: "ses_tui_memory",
      event: {
        on(type, fn) {
          handlers[type] = [...(handlers[type] ?? []), fn]
        },
      },
      toast: {
        show() {},
      },
    })

    expect(handlers).toEqual({ "memory.error": [expect.any(Function)] })
  })

  test("keeps generic and detailed errors visible", async () => {
    const shown: string[] = []
    const handlers: Record<string, Handler[]> = {}
    MemoryTuiEvents.attach({
      sessionID: "ses_tui_memory",
      event: {
        on(type, fn) {
          handlers[type] = [...(handlers[type] ?? []), fn]
        },
      },
      toast: {
        show(input) {
          shown.push(input.message)
        },
      },
    })

    await Promise.all(
      (handlers["memory.error"] ?? []).map((fn) =>
        fn({ properties: { sessionID: "ses_tui_memory", reason: "model failed" } }),
      ),
    )
    await Promise.all(
      (handlers["memory.error"] ?? []).map((fn) =>
        fn({ properties: { sessionID: "ses_tui_memory", detail: { message: "Memory save failed" } } }),
      ),
    )

    expect(shown).toEqual(["Memory error · model failed", "Memory save failed"])
  })
})

describe("memory TUI metadata", () => {
  test("reads typed verbose and activity state", () => {
    expect(MemoryTuiState.verbose({ verbose: true })).toBe(true)
    expect(MemoryTuiState.verbose(undefined)).toBe(false)
    expect(MemoryTuiState.active({ markers: 1, saved: false })).toBe(true)
    expect(MemoryTuiState.active({ markers: 0, saved: true })).toBe(true)
    expect(MemoryTuiState.active({ markers: 0, saved: false })).toBe(false)
    expect(MemoryTuiMeta.items({ items: ["first", 1, "second"] })).toEqual(["first", "second"])
    expect(MemoryTuiMeta.items({})).toEqual([])
  })
})

describe("memory sidebar row", () => {
  test("shows loading, unavailable, and disabled states", () => {
    expect(memoryRow({ loading: true, active: false, verbose: false })).toEqual({
      label: "Loading",
      tone: "muted",
    })
    expect(memoryRow({ active: false, verbose: false })).toEqual({
      label: "Unavailable",
      tone: "error",
    })
    expect(memoryRow({ enabled: false, active: true, verbose: true, flash: "recalled 3" })).toEqual({
      label: "Disabled",
      tone: "muted",
    })
  })

  test("uses muted and green dots for inactive and active sessions", () => {
    expect(memoryRow({ enabled: true, active: false, verbose: false })).toEqual({
      label: "Enabled",
      tone: "muted",
    })
    expect(memoryRow({ enabled: true, active: true, verbose: false })).toEqual({
      label: "Enabled",
      tone: "success",
    })
  })

  test("adds verbose event captions without changing the activity tone", () => {
    expect(memoryRow({ enabled: true, active: false, verbose: true, flash: "recalled 3" })).toEqual({
      label: "Enabled",
      tone: "muted",
      caption: "recalled 3",
    })
    expect(memoryRow({ enabled: true, active: true, verbose: true, flash: "saved 2" })).toEqual({
      label: "Enabled",
      tone: "success",
      caption: "saved 2",
    })
  })

  test("omits verbose event captions when verbose is disabled", () => {
    expect(memoryRow({ enabled: true, active: true, verbose: false, flash: "loaded" })).toEqual({
      label: "Enabled",
      tone: "success",
      caption: undefined,
    })
  })
})
