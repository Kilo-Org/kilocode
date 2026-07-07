import { describe, expect, test } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2"
import { runMemoryCommand } from "@/kilocode/cli/cmd/tui/memory-command"
import { MemoryTuiEvents } from "@/kilocode/cli/cmd/tui/memory-events"

type Handler = (event: { properties: { sessionID?: string; detail?: unknown } }) => void

describe("memory TUI command parser", () => {
  test("manual mutation toasts match server event wording", async () => {
    const shown: string[] = []
    const result = {
      data: {
        operationCount: 1,
        removed: 1,
        index: { tokens: 1234 },
      },
    }
    const client = {
      memory: {
        remember: async () => result,
        correct: async () => result,
        forget: async () => result,
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
    }

    await runMemoryCommand({ ...base, text: "/memory remember tests run from packages/opencode" })
    await runMemoryCommand({ ...base, text: "/memory correct old test command is wrong" })
    await runMemoryCommand({ ...base, text: "/memory forget old test command" })

    expect(shown).toEqual(["Memory saved · 1 change", "Correction saved · 1 change", "Memory updated · 1 removed"])
    expect(shown.join("\n")).not.toContain("1,234")
    expect(shown.join("\n")).not.toContain("memory tokens")
  })

  test("auto-save and purge commands call explicit endpoints", async () => {
    const shown: string[] = []
    const calls: unknown[] = []
    const state = { autoConsolidate: true }
    const client = {
      memory: {
        status: async () => ({ data: { state } }),
        configure: async (input: unknown) => {
          calls.push(input)
          return { data: { state: { autoConsolidate: false } } }
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
    await runMemoryCommand({ ...base, text: "/memory auto status" })
    await runMemoryCommand({ ...base, text: "/memory purge" })
    await runMemoryCommand({ ...base, text: "/memory purge confirm" })

    expect(shown[0]).toBe("Memory auto-save off")
    expect(shown[1]).toContain("Missing auto mode")
    expect(shown[2]).toContain("Purge requires confirmation")
    expect(shown[3]).toBe("Memory purged")
    expect(calls).toEqual([{ autoConsolidate: false }, { confirm: true }])
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
    expect(shown[0]).toContain("Memory enabled")
    expect(shown[1]).toBe("Memory disabled")
  })

  test("memory commands route to session directory when no workspace is active", async () => {
    const calls: unknown[] = []
    const state = { autoConsolidate: false }
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
    await runMemoryCommand({
      ...base,
      text: "/memory auto off",
      workspace: "wrk_123",
      directory: "/repo/packages/opencode",
    })

    expect(calls).toEqual([
      { directory: "/repo/packages/opencode", autoConsolidate: false },
      { workspace: "wrk_123", autoConsolidate: false },
    ])
  })
})

describe("memory TUI events", () => {
  test("dedupes repeated recall toasts for the same recalled files", () => {
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

    const emit = (detail: unknown) => {
      for (const fn of handlers["memory.status"] ?? []) {
        fn({ properties: { sessionID: "ses_tui_memory", detail } })
      }
    }
    emit({ type: "recalled", message: "Memory recalled · 1 item", files: ["project.md"] })
    emit({ type: "recalled", message: "Memory recalled · 1 item", files: ["project.md"] })
    emit({ type: "recalled", message: "Memory recalled · 2 items", files: ["project.md", "environment.md"] })
    emit({ type: "skipped", message: "Memory checked · no new items" })
    emit({ type: "saved", message: "Memory saved · project.md" })

    expect(shown).toEqual(["Memory recalled · 1 item", "Memory recalled · 2 items", "Memory saved · project.md"])
  })
})
