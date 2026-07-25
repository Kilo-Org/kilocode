/** @jsxImportSource @opentui/solid */
import { expect, spyOn, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { TuiPluginApi } from "@kilocode/plugin/tui"
import type { Event, Message, Part, Session } from "@kilocode/sdk/v2"
import { createSignal } from "solid-js"
import { MemorySidebar } from "@/kilocode/cli/cmd/tui/component/memory-status"
import { directory } from "../../../../fixture/tui-sdk"

const id = "ses_memory_status"

const session = {
  id,
  slug: "memory-status",
  projectID: "proj_test",
  directory,
  title: "Memory status",
  version: "1",
  time: { created: 1, updated: 1 },
} satisfies Session

function event(sessionID?: string, count?: number): Extract<Event, { type: "memory.status" }> {
  return {
    id: `evt_memory_${sessionID ?? "project"}_${count ?? 0}`,
    type: "memory.status",
    properties: {
      directory,
      ...(sessionID ? { sessionID } : {}),
      enabled: true,
      state: "idle",
      project: { bytes: 0, estimatedTokens: 0, truncated: false },
      ...(count === undefined
        ? {}
        : { detail: { type: "saved" as const, message: `Memory saved · ${count}`, operationCount: count } }),
    },
  }
}

async function wait(fn: () => boolean, timeout = 2_000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for memory TUI state")
    await Bun.sleep(10)
  }
}

type Handler = (event: Event) => void

function bus() {
  const handlers = new Map<string, Set<Handler>>()
  return {
    on(type: string, fn: Handler) {
      const items = handlers.get(type) ?? new Set<Handler>()
      items.add(fn)
      handlers.set(type, items)
      return () => items.delete(fn)
    },
    emit(value: Event) {
      for (const fn of handlers.get(value.type) ?? []) fn(value)
    },
  }
}

test("sidebar refetches status and scopes save activity", async () => {
  const [parts, setParts] = createSignal<Part[]>([])
  const events = bus()
  const calls = { count: 0 }
  const api = {
    state: {
      path: { directory },
      session: {
        get: () => session,
        messages: () => [{ id: "msg_memory_sidebar" } as Message],
      },
      part: () => parts(),
    },
    client: {
      memory: {
        status: async () => {
          calls.count += 1
          return { data: { state: { enabled: true } } }
        },
      },
    },
    event: events,
    theme: {
      current: {
        text: RGBA.fromHex("#ffffff"),
        textMuted: RGBA.fromHex("#888888"),
        success: RGBA.fromHex("#00ff00"),
        error: RGBA.fromHex("#ff0000"),
      },
    },
  } as unknown as TuiPluginApi
  const clear = spyOn(globalThis, "clearTimeout")
  const app = await testRender(() => <MemorySidebar api={api} sessionID={id} />, { width: 80, height: 5 })

  try {
    await wait(() => calls.count === 1 && app.captureCharFrame().includes("Enabled"))
    setParts([
      {
        id: "part_memory_sidebar",
        sessionID: id,
        messageID: "msg_memory_sidebar",
        type: "text",
        text: "",
        metadata: { kiloMemory: { type: "recall", count: 2 } },
      },
    ])
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("recalled 2")

    events.emit(event("ses_other", 4))
    await wait(() => calls.count === 2)

    events.emit(event(id, 3))
    await wait(() => calls.count === 3)
    expect(app.captureCharFrame()).not.toContain("saved 3")
    const before = clear.mock.calls.length
    app.renderer.destroy()
    expect(clear.mock.calls.length).toBeGreaterThan(before)
  } finally {
    if (!app.renderer.isDestroyed) app.renderer.destroy()
    clear.mockRestore()
  }
}, 10_000)
