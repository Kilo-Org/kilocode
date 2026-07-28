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
  const events = { activated: [] as string[], selected: [] as string[], saved: 0, shown: [] as string[], hidden: 0 }
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
    onHideSide: () => events.hidden++,
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
    showError: () => undefined,
    postMessage: (message) => posted.push(message as Record<string, unknown>),
  })
  return { state, selection, setSelection, posted, events, handlers, dispatch }
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

      expect(item.state.current().map((term) => term.id)).toEqual(["terminal:tab"])
      expect(item.state.all().map((term) => term.id)).toEqual(["terminal:tab"])
      expect(item.state.sides().map((term) => term.id)).toEqual(["terminal:side"])
      expect(item.state.side()?.id).toBe("terminal:side")

      item.setSelection(null)
      expect(item.state.current()).toEqual([])
      expect(item.state.sideKey()).toBe(LOCAL)
      expect(item.state.side()?.id).toBe("terminal:side")
      dispose()
    })
  })

  it("deduplicates side creation and reuses the terminal without tab side effects", () => {
    createRoot((dispose) => {
      const item = scene()
      item.handlers.requestSide()
      item.handlers.requestSide()

      expect(item.posted).toHaveLength(1)
      const request = item.posted[0]!
      expect(request).toMatchObject({ type: "agentManager.terminal.create", placement: "side", worktreeId: null })
      const createId = String(request.createId)
      const created = {
        type: "agentManager.terminal.created",
        createId,
        placement: "side",
        worktreeId: null,
        terminalId: "terminal:side",
        title: "Terminal 1",
        wsUrl: "ws://side",
        font,
      } satisfies ExtensionMessage
      expect(item.dispatch(created)).toBe(true)
      expect(item.state.side()?.id).toBe("terminal:side")
      expect(item.events.activated).toEqual([])
      expect(item.events.selected).toEqual([])
      expect(item.events.saved).toBe(0)

      item.handlers.requestSide()
      expect(item.posted).toHaveLength(1)
      expect(item.state.focusRequest()?.id).toBe("terminal:side")
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

  it("cancels a side terminal that is still starting", () => {
    createRoot((dispose) => {
      const item = scene()
      item.handlers.requestSide()
      const request = item.posted[0]!
      expect(item.handlers.closeSide()).toBe(true)
      expect(item.state.pendingSide(LOCAL)).toBeUndefined()

      item.dispatch({
        type: "agentManager.terminal.created",
        createId: String(request.createId),
        placement: "side",
        worktreeId: null,
        terminalId: "terminal:late",
        title: "Terminal 1",
        wsUrl: "ws://late",
        font,
      })
      expect(item.state.side()).toBeUndefined()
      expect(item.posted.at(-1)).toEqual({ type: "agentManager.terminal.close", terminalId: "terminal:late" })
      dispose()
    })
  })

  it("closes a side terminal without changing the active chat tab", () => {
    createRoot((dispose) => {
      const item = scene()
      item.state.add(null, {
        id: "terminal:side",
        title: "Terminal 1",
        wsUrl: "ws://side",
        font,
        placement: "side",
      })
      expect(item.handlers.closeSide()).toBe(true)
      expect(item.state.side()).toBeUndefined()
      expect(item.posted).toEqual([{ type: "agentManager.terminal.close", terminalId: "terminal:side" }])
      expect(item.events.hidden).toBe(1)
      dispose()
    })
  })
})
