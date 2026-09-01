import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createBrowserController } from "../../webview-ui/browser/controller"
import type { BrowserReference } from "../../src/shared/browser-feedback"
import type {
  BrowserCommand,
  BrowserEvent,
  BrowserInspection,
  BrowserPosition,
  BrowserScope,
} from "../../webview-ui/browser/types"

const point = (x: number): BrowserPosition => ({ x, y: x, width: 100, height: 100 })

function setup(theme: "dark" | "light" = "dark") {
  const sent: BrowserCommand[] = []
  const references: BrowserReference[] = []
  const listeners = new Set<(event: BrowserEvent) => void>()
  const frames = new Map<number, FrameRequestCallback>()
  const cancelled: number[] = []
  let nextFrame = 0
  let setScope: (value: BrowserScope | undefined) => void = () => {}
  let controller!: ReturnType<typeof createBrowserController>
  let dispose!: () => void
  createRoot((rootDispose) => {
    dispose = rootDispose
    const [scope, update] = createSignal<BrowserScope | undefined>({
      sessionId: "session-a",
      projectId: "project-a",
    })
    setScope = update
    controller = createBrowserController({
      scope,
      transport: {
        send: (command) => sent.push(command),
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
      onReference: (reference) => references.push(reference),
      onClose: () => {},
      theme: () => theme,
      schedule: (callback) => {
        const id = ++nextFrame
        frames.set(id, callback)
        return id
      },
      cancel: (id) => {
        cancelled.push(id)
        frames.delete(id)
      },
    })
  })
  const emit = (event: BrowserEvent) => listeners.forEach((listener) => listener(event))
  const run = () => {
    const item = frames.entries().next().value as [number, FrameRequestCallback] | undefined
    if (!item) throw new Error("No animation frame scheduled")
    frames.delete(item[0])
    item[1](0)
  }
  return { controller, sent, emit, frames, cancelled, setScope, dispose, run, listeners, references }
}

function inspection(requestId: string, scope: BrowserScope, error?: string): BrowserInspection {
  return {
    requestId,
    scope,
    hover: true,
    error,
    element: error
      ? undefined
      : { tag: "button", selector: `button-${requestId}`, rect: { x: 0, y: 0, width: 1, height: 1 } },
    logs: [],
  }
}

describe("browser controller", () => {
  test("coalesces pointer movement while an inspection is active", () => {
    const view = setup()
    view.controller.toggleSelecting()
    view.controller.move(point(0.1))
    view.run()
    view.controller.move(point(0.2))
    view.controller.move(point(0.3))

    expect(view.sent.filter((item) => item.type === "inspect")).toHaveLength(1)
    view.emit({
      type: "inspection",
      value: inspection("1", { sessionId: "session-a", projectId: "project-a" }),
    })
    expect(view.frames.size).toBe(1)
    view.run()

    expect(view.sent.filter((item) => item.type === "inspect")).toHaveLength(2)
    expect(view.sent.at(-1)).toMatchObject({ type: "inspect", requestId: "2", position: point(0.3) })
    view.dispose()
  })

  test("recovers hover scheduling after a matching failed response", () => {
    const view = setup()
    view.controller.toggleSelecting()
    view.controller.move(point(0.1))
    view.run()
    view.controller.move(point(0.4))

    view.emit({
      type: "inspection",
      value: inspection("1", { sessionId: "session-a", projectId: "project-a" }, "Inspection failed"),
    })
    expect(view.controller.hovered()).toBeUndefined()
    expect(view.frames.size).toBe(1)
    view.run()

    expect(view.sent.at(-1)).toMatchObject({ type: "inspect", requestId: "2", position: point(0.4) })
    view.dispose()
  })

  test("ignores stale request and wrong scope responses", () => {
    const view = setup()
    view.controller.toggleSelecting()
    view.controller.move(point(0.1))
    view.run()
    view.emit({
      type: "inspection",
      value: inspection("old", { sessionId: "session-a", projectId: "project-a" }),
    })
    view.emit({
      type: "inspection",
      value: inspection("1", { sessionId: "session-b", projectId: "project-a" }),
    })
    view.emit({
      type: "inspection",
      value: inspection("1", { sessionId: "session-a", projectId: "project-b" }),
    })
    expect(view.controller.hovered()).toBeUndefined()
    expect(view.frames.size).toBe(0)

    view.emit({
      type: "inspection",
      value: inspection("1", { sessionId: "session-a", projectId: "project-a" }),
    })
    expect(view.controller.hovered()?.element?.selector).toBe("button-1")
    view.dispose()
  })

  test("ignores events and cancels scheduled work after cleanup", () => {
    const view = setup()
    view.controller.toggleSelecting()
    view.controller.move(point(0.1))
    expect(view.frames.size).toBe(1)
    view.dispose()

    expect(view.cancelled).toEqual([1])
    expect(view.frames.size).toBe(0)
    view.emit({
      type: "inspection",
      value: inspection("1", { sessionId: "session-a", projectId: "project-a" }),
    })
    expect(view.controller.hovered()).toBeUndefined()
    view.controller.state()
    view.controller.toggleSelecting()
    view.controller.move(point(0.2))
    view.controller.setUrl("localhost:3000")
    view.controller.open()
    view.controller.toggleTools()
    expect(view.listeners.size).toBe(0)
    expect(view.frames.size).toBe(0)
    expect(view.controller.selecting()).toBe(false)
    expect(view.sent).toEqual([{ type: "state", scope: { sessionId: "session-a", projectId: "project-a" } }])
  })

  test("uses an injected theme without reading host DOM or VS Code classes", () => {
    const view = setup("light")
    view.controller.toggleTools()
    expect(view.sent.at(-1)).toEqual({
      type: "devtools",
      scope: { sessionId: "session-a", projectId: "project-a" },
      theme: "light",
    })
    view.dispose()
  })

  test.each(["error", "empty", "selectorless"] as const)("recovers from %s selection responses", (mode) => {
    const view = setup()
    const scope = { sessionId: "session-a", projectId: "project-a" }
    view.controller.toggleSelecting()
    view.controller.select(point(0.2))
    expect(view.controller.selecting()).toBe(false)
    const value = inspection("1", scope, mode === "error" ? "Navigation interrupted" : undefined)
    if (mode === "empty") value.element = undefined
    if (mode === "selectorless") value.element = { tag: "button", selector: "" }
    view.emit({ type: "inspection", value: { ...value, hover: false } })
    expect(view.controller.selecting()).toBe(true)
    expect(view.references).toEqual([])
    view.controller.select(point(0.3))
    view.emit({ type: "inspection", value: { ...inspection("2", scope), hover: false } })
    expect(view.references).toHaveLength(1)
    expect(view.references[0]?.selector).toBe("button-2")
    expect(view.controller.selecting()).toBe(false)
    view.dispose()
  })

  test("does not attach stale selections after navigation or browser closure", () => {
    const view = setup()
    const scope = { sessionId: "session-a", projectId: "project-a" }
    const state = { scope, browserId: "browser", status: "ready" as const, navigation: 1, errors: 0 }
    view.emit({ type: "state", value: state })
    view.controller.select(point(0.2))
    view.emit({ type: "state", value: { ...state, navigation: 2, status: "loading" } })
    view.emit({ type: "inspection", value: { ...inspection("1", scope), hover: false } })
    expect(view.references).toEqual([])
    view.controller.select(point(0.3))
    view.emit({ type: "state", value: { ...state, navigation: 2, status: "closed", inspecting: true } })
    view.emit({ type: "inspection", value: { ...inspection("2", scope), hover: false } })
    expect(view.references).toEqual([])
    expect(view.controller.pointing()).toBe(false)
    expect(view.controller.selecting()).toBe(false)
    view.dispose()
  })

  test("drops state from the previous scope before accepting the new scope", async () => {
    const view = setup()
    view.emit({
      type: "state",
      value: {
        scope: { sessionId: "session-a", projectId: "project-a" },
        browserId: "browser-a",
        status: "ready",
        errors: 0,
        url: "http://localhost:3000",
      },
    })
    expect(view.controller.state()?.browserId).toBe("browser-a")
    view.setScope({ sessionId: "session-b", projectId: "project-b" })
    await Promise.resolve()
    expect(view.controller.state()).toBeUndefined()
    view.emit({
      type: "state",
      value: {
        scope: { sessionId: "session-a", projectId: "project-a" },
        browserId: "old-browser",
        status: "ready",
        errors: 0,
      },
    })
    expect(view.controller.state()).toBeUndefined()
    view.dispose()
  })
})
