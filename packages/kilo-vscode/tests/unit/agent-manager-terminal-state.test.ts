import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { LOCAL } from "../../webview-ui/agent-manager/navigate"
import {
  createTerminalHandlers,
  createTerminalMessageHandler,
  createTerminalState,
} from "../../webview-ui/agent-manager/terminal/state"
import type { ExtensionMessage } from "../../webview-ui/src/types/messages/extension-messages"

const font = { fontFamily: "Menlo", fontSize: 12 }

function scene(initial: string | null = LOCAL) {
  const [selection, setSelection] = createSignal<string | null>(initial)
  const state = createTerminalState(selection)
  const posted: Array<Record<string, unknown>> = []
  const events = { activated: [] as string[], selected: [] as string[], saved: 0, shown: [] as string[], errors: 0 }
  const tabs = () => state.current().map((term) => term.id)
  const handlers = createTerminalHandlers({
    state,
    tabIds: tabs,
    selectReview: () => undefined,
    selectSessionTab: () => undefined,
    clearSession: () => undefined,
    resetOthers: () => undefined,
    isPendingId: () => false,
    findTab: () => undefined,
    postMessage: (message) => posted.push(message as Record<string, unknown>),
    onShowSide: (key) => events.shown.push(key),
    getSelection: selection,
    LOCAL,
    REVIEW_TAB_ID: "review",
  })
  const dispatch = createTerminalMessageHandler({
    state,
    activate: (id) => events.activated.push(id),
    saveTabMemory: () => events.saved++,
    setSelection: (value) => {
      events.selected.push(value)
      setSelection(value)
    },
    showError: () => events.errors++,
    postMessage: (message) => posted.push(message as Record<string, unknown>),
  })
  return { state, selection, setSelection, posted, events, handlers, dispatch }
}

function createdSide(createId: string, terminalId: string, title = "Terminal 1") {
  return {
    type: "agentManager.terminal.created",
    createId,
    placement: "side",
    worktreeId: null,
    terminalId,
    title,
    wsUrl: `ws://${terminalId}`,
    font,
  } satisfies ExtensionMessage
}

describe("Agent Manager terminal state", () => {
  it("keeps side terminals out of the tab state and shares root context with unassigned sessions", () => {
    createRoot((dispose) => {
      const item = scene()
      item.state.add(null, {
        id: "terminal:tab",
        title: "Terminal 1",
        wsUrl: "ws://tab",
        font,
        placement: "tab",
      })
      item.state.add(null, {
        id: "terminal:side",
        title: "Terminal 2",
        wsUrl: "ws://side",
        font,
        placement: "side",
      })
      item.state.setSideActive(LOCAL, "terminal:side")

      expect(item.state.current().map((term) => term.id)).toEqual(["terminal:tab"])
      expect(item.state.all().map((term) => term.id)).toEqual(["terminal:tab"])
      expect(item.state.sides().map((term) => term.id)).toEqual(["terminal:side"])
      expect(item.state.sideActiveFor(LOCAL)).toBe("terminal:side")

      item.setSelection(null)
      expect(item.state.current()).toEqual([])
      expect(item.state.sideKey()).toBe(LOCAL)
      expect(item.state.sideActiveFor(LOCAL)).toBe("terminal:side")
      dispose()
    })
  })

  it("deduplicates an in-flight reveal and focuses the active terminal on repeat", () => {
    createRoot((dispose) => {
      const item = scene()
      item.handlers.requestSide()
      item.handlers.requestSide()

      expect(item.posted).toHaveLength(1)
      const request = item.posted[0]!
      expect(request).toMatchObject({ type: "agentManager.terminal.create", placement: "side", worktreeId: null })
      const createId = String(request.createId)
      expect(item.dispatch(createdSide(createId, "terminal:side"))).toBe(true)
      expect(item.state.sideActiveFor(LOCAL)).toBe("terminal:side")
      expect(item.events.activated).toEqual([])
      expect(item.events.selected).toEqual([])
      expect(item.events.saved).toBe(0)

      item.handlers.requestSide()
      expect(item.posted).toHaveLength(1)
      expect(item.state.focusRequest()?.id).toBe("terminal:side")
      dispose()
    })
  })

  it("supports several side terminals per context with newest active", () => {
    createRoot((dispose) => {
      const item = scene()
      item.handlers.addSide()
      item.handlers.addSide()
      expect(item.posted).toHaveLength(2)
      const first = String(item.posted[0]!.createId)
      const second = String(item.posted[1]!.createId)

      item.dispatch(createdSide(first, "terminal:one", "Terminal 1"))
      expect(item.state.sidesForContext(LOCAL).map((term) => term.id)).toEqual(["terminal:one"])
      expect(item.state.sideActiveFor(LOCAL)).toBe("terminal:one")

      item.dispatch(createdSide(second, "terminal:two", "Terminal 2"))
      expect(item.state.sidesForContext(LOCAL).map((term) => term.id)).toEqual(["terminal:one", "terminal:two"])
      expect(item.state.sideActiveFor(LOCAL)).toBe("terminal:two")
      dispose()
    })
  })

  it("switches the active side terminal on select", () => {
    createRoot((dispose) => {
      const item = scene()
      item.state.add(null, { id: "terminal:one", title: "Terminal 1", wsUrl: "ws://one", font, placement: "side" })
      item.state.add(null, { id: "terminal:two", title: "Terminal 2", wsUrl: "ws://two", font, placement: "side" })
      item.state.setSideActive(LOCAL, "terminal:two")

      item.handlers.selectSide("terminal:one")
      expect(item.state.sideActiveFor(LOCAL)).toBe("terminal:one")
      expect(item.state.focusRequest()?.id).toBe("terminal:one")
      dispose()
    })
  })

  it("moves activation to the last remaining side terminal on close", () => {
    createRoot((dispose) => {
      const item = scene()
      item.state.add(null, { id: "terminal:one", title: "Terminal 1", wsUrl: "ws://one", font, placement: "side" })
      item.state.add(null, { id: "terminal:two", title: "Terminal 2", wsUrl: "ws://two", font, placement: "side" })
      item.state.setSideActive(LOCAL, "terminal:two")

      expect(item.handlers.closeSide("terminal:two")).toBe(true)
      expect(item.state.sideActiveFor(LOCAL)).toBe("terminal:one")
      expect(item.posted).toEqual([{ type: "agentManager.terminal.close", terminalId: "terminal:two" }])

      expect(item.handlers.closeSide("terminal:one")).toBe(true)
      expect(item.state.sideActiveFor(LOCAL)).toBeUndefined()
      expect(item.state.sidesForContext(LOCAL)).toEqual([])

      // Closing an unknown or non-side id is a no-op.
      expect(item.handlers.closeSide("terminal:gone")).toBe(false)
      expect(item.posted).toHaveLength(2)
      dispose()
    })
  })

  it("closes a stale side answer whose create request is unknown", () => {
    createRoot((dispose) => {
      const item = scene()
      // A created message for a createId the webview never sent (e.g. it
      // reloaded while the PTY was starting) must not leak the PTY.
      item.dispatch(createdSide("stale-id", "terminal:stale"))
      expect(item.state.sidesForContext(LOCAL)).toEqual([])
      expect(item.posted).toEqual([{ type: "agentManager.terminal.close", terminalId: "terminal:stale" }])
      dispose()
    })
  })

  it("creates explicit terminal tabs independently of the side destination", () => {
    createRoot((dispose) => {
      const item = scene("wt-1")
      item.handlers.requestNew()
      expect(item.posted[0]).toMatchObject({
        type: "agentManager.terminal.create",
        placement: "tab",
        worktreeId: "wt-1",
      })
      dispose()
    })
  })

  it("routes side creates of a worktree context to that worktree", () => {
    createRoot((dispose) => {
      const item = scene("wt-1")
      item.handlers.addSide()
      expect(item.posted[0]).toMatchObject({
        type: "agentManager.terminal.create",
        placement: "side",
        worktreeId: "wt-1",
      })
      dispose()
    })
  })

  it("tracks OSC titles per terminal without touching the terminal records", () => {
    createRoot((dispose) => {
      const item = scene()
      item.state.add(null, { id: "terminal:one", title: "Terminal 1", wsUrl: "ws://one", font, placement: "side" })
      const before = item.state.sidesForContext(LOCAL)[0]!

      item.state.setTitle("terminal:one", "npm run dev")
      expect(item.state.title("terminal:one")).toBe("npm run dev")
      // Reference stability: the stored record is untouched so <For> does
      // not remount the xterm instance on a title change.
      expect(item.state.sidesForContext(LOCAL)[0]).toBe(before)

      // Empty titles are ignored; removal drops the override.
      item.state.setTitle("terminal:one", "  ")
      expect(item.state.title("terminal:one")).toBe("npm run dev")
      item.state.remove("terminal:one")
      expect(item.state.title("terminal:one")).toBeUndefined()
      dispose()
    })
  })

  it("reorders side terminals within their context via drag", () => {
    createRoot((dispose) => {
      const item = scene()
      item.state.add(null, { id: "terminal:one", title: "Terminal 1", wsUrl: "ws://one", font, placement: "side" })
      item.state.add(null, { id: "terminal:two", title: "Terminal 2", wsUrl: "ws://two", font, placement: "side" })
      item.state.add(null, { id: "terminal:three", title: "Terminal 3", wsUrl: "ws://three", font, placement: "side" })
      item.state.add(null, { id: "terminal:tab", title: "Terminal 4", wsUrl: "ws://tab", font, placement: "tab" })

      // Drag the first side terminal onto the third position.
      expect(item.state.reorderSideDrag(LOCAL, "terminal:one", "terminal:three")).toBe(true)
      expect(item.state.sidesForContext(LOCAL).map((term) => term.id)).toEqual([
        "terminal:two",
        "terminal:three",
        "terminal:one",
      ])
      // Tab terminals are untouched.
      expect(item.state.current().map((term) => term.id)).toEqual(["terminal:tab"])

      // The order survives switching to another context and back.
      item.setSelection("wt-1")
      expect(item.state.sidesForContext(LOCAL).map((term) => term.id)).toEqual([
        "terminal:two",
        "terminal:three",
        "terminal:one",
      ])
      item.setSelection(LOCAL)
      expect(item.state.sidesForContext(LOCAL).map((term) => term.id)).toEqual([
        "terminal:two",
        "terminal:three",
        "terminal:one",
      ])

      // Unknown ids, tab-placement ids, and foreign contexts are rejected.
      expect(item.state.reorderSideDrag(LOCAL, "terminal:gone", "terminal:two")).toBe(false)
      expect(item.state.reorderSideDrag(LOCAL, "terminal:tab", "terminal:two")).toBe(false)
      expect(item.state.reorderSideDrag("wt-1", "terminal:two", "terminal:three")).toBe(false)
      dispose()
    })
  })

  it("reports the focused side terminal only for the current context", () => {
    createRoot((dispose) => {
      const item = scene()
      item.state.add(null, { id: "terminal:side", title: "Terminal 1", wsUrl: "ws://side", font, placement: "side" })
      item.state.add(null, { id: "terminal:tab", title: "Terminal 2", wsUrl: "ws://tab", font, placement: "tab" })

      expect(item.state.sideFocusedId()).toBeUndefined()
      item.state.setFocusedId("terminal:tab")
      expect(item.state.sideFocusedId()).toBeUndefined()
      item.state.setFocusedId("terminal:side")
      expect(item.state.sideFocusedId()).toBe("terminal:side")
      dispose()
    })
  })
})
