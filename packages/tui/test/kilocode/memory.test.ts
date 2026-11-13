import { describe, expect, test } from "bun:test"
import type { KiloMemoryRpc } from "@opencode/schema/kilocode/memory"
import { autosave, draft } from "../../src/kilocode/components/dialog-memory"
import { memoryRow } from "../../src/kilocode/components/memory-status"
import { MemoryTuiEvents } from "../../src/kilocode/memory-events"
import { memoryToolTitle } from "../../src/kilocode/memory-tool"
import { permissionPresentation } from "../../src/util/permission"

describe("memory help dialog", () => {
  test("drafts commands that need input without their placeholder", () => {
    expect(draft("remember <text>")).toBe("remember ")
    expect(draft("auto on|off")).toBe("auto ")
    expect(draft("purge confirm")).toBe("purge confirm")
    expect(draft("on")).toBe("on")
  })

  test("summarizes automatic saves", () => {
    const stats = { lastTypedConsolidationAt: null, lastSessionSavedAt: null, lastOperationCount: 0 }
    expect(autosave({ autoConsolidate: false, stats })).toBe("off")
    expect(autosave({ autoConsolidate: true, stats })).toBe("on · watching…")
    expect(
      autosave({
        autoConsolidate: true,
        stats: { ...stats, lastTypedConsolidationAt: Date.now(), lastOperationCount: 2 },
      }),
    ).toBe("on · saved · just now")
  })
})

describe("memoryRow", () => {
  test("shows loading, then unavailable when the status request failed", () => {
    expect(memoryRow({ loading: true, active: false })).toEqual({ label: "Loading", tone: "muted" })
    expect(memoryRow({ loading: false, active: false })).toEqual({ label: "Unavailable", tone: "error" })
  })

  test("shows disabled memory muted even when the session used it", () => {
    expect(memoryRow({ enabled: false, active: true })).toEqual({ label: "Disabled", tone: "muted" })
  })

  test("marks enabled memory as successful only when the session used or saved memory", () => {
    expect(memoryRow({ enabled: true, active: false })).toEqual({ label: "Enabled", tone: "muted" })
    expect(memoryRow({ enabled: true, active: true })).toEqual({ label: "Enabled", tone: "success" })
  })
})

describe("memory permission presentation", () => {
  test("shows the save action and the text to remember", () => {
    expect(
      permissionPresentation({
        action: "kilo_memory_save",
        resources: [],
        metadata: { action: "remember", key: "deploy", text: "we deploy with fly deploy" },
      }),
    ).toEqual({ icon: "◇", title: "Memory remember", lines: ["we deploy with fly deploy"] })
  })

  test("shows the recall query, falling back to the tool input", () => {
    expect(
      permissionPresentation({
        action: "kilo_memory_recall",
        resources: [],
        metadata: { mode: "search" },
        input: { mode: "search", query: "test command" },
      }),
    ).toEqual({ icon: "◇", title: "Memory recall", lines: ["test command"] })
  })

  test("says when no memory content was provided", () => {
    expect(permissionPresentation({ action: "kilo_memory_save", resources: [], metadata: {} })).toEqual({
      icon: "◇",
      title: "Memory save",
      lines: ["No memory content provided"],
    })
  })
})

describe("memoryToolTitle", () => {
  test("names the recall mode, the query and the result", () => {
    expect(
      memoryToolTitle({
        tool: "kilo_memory_recall",
        input: { mode: "search", query: "test command" },
        metadata: { title: "Kilo memory search: 2 hits" },
      }),
    ).toBe('Memory search "test command" · 2 hits')
    expect(memoryToolTitle({ tool: "kilo_memory_recall", input: { mode: "catalog" }, metadata: {} })).toBe(
      "Memory catalog",
    )
  })

  test("names the save action, the text and the result", () => {
    expect(
      memoryToolTitle({
        tool: "kilo_memory_save",
        input: { action: "remember", text: "we deploy with fly deploy" },
        metadata: { title: "Kilo memory saved: 1 op" },
      }),
    ).toBe('Memory remember "we deploy with fly deploy" · 1 op')
    expect(memoryToolTitle({ tool: "kilo_memory_save", input: { action: "forget", query: "npm" }, metadata: {} })).toBe(
      'Memory forget "npm"',
    )
  })

  test("clips long text to one line", () => {
    const title = memoryToolTitle({
      tool: "kilo_memory_save",
      input: { action: "remember", text: `first\nsecond ${"x".repeat(200)}` },
      metadata: {},
    })
    expect(title.startsWith('Memory remember "first second ')).toBe(true)
    expect(title.length).toBeLessThan(100)
  })
})

describe("MemoryTuiEvents", () => {
  const event = (input: Partial<KiloMemoryRpc.Event>): KiloMemoryRpc.Event => ({
    directory: "/memory",
    enabled: true,
    state: "error",
    project: { bytes: 0, estimatedTokens: 0, truncated: false },
    ...input,
  })

  function harness(session: string | undefined) {
    const handlers: Array<(event: { data: KiloMemoryRpc.Event }) => void> = []
    const toasts: string[] = []
    const stop = MemoryTuiEvents.attach({
      event: {
        on: (_type, fn) => {
          handlers.push(fn)
          return () => handlers.splice(handlers.indexOf(fn), 1)
        },
      },
      toast: { show: (toast) => toasts.push(`${toast.variant}:${toast.message}`) },
      sessionID: () => session,
    })
    return { emit: (data: KiloMemoryRpc.Event) => handlers.forEach((fn) => fn({ data })), toasts, stop, handlers }
  }

  test("toasts errors of the open session and errors without a session", () => {
    const app = harness("ses_1")
    app.emit(event({ sessionID: "ses_1", detail: { type: "error", message: "Memory save failed" } }))
    app.emit(event({ reason: "storage" }))
    expect(app.toasts).toEqual(["error:Memory save failed", "error:Memory error · storage"])
  })

  test("skips other sessions, transient failures and views without a session", () => {
    const app = harness("ses_1")
    app.emit(event({ sessionID: "ses_2", detail: { type: "error", message: "other" } }))
    app.emit(event({ sessionID: "ses_1", reason: "transient" }))
    expect(app.toasts).toEqual([])
    const home = harness(undefined)
    home.emit(event({ detail: { type: "error", message: "home" } }))
    expect(home.toasts).toEqual([])
  })

  test("stops listening on cleanup", () => {
    const app = harness("ses_1")
    app.stop()
    expect(app.handlers).toHaveLength(0)
  })
})
