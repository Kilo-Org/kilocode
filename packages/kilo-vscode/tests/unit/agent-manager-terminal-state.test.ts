import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { LOCAL } from "../../webview-ui/agent-manager/navigate"
import {
  createTerminalHandlers,
  createTerminalMessageHandler,
  createTerminalState,
  isTerminalTabId,
} from "../../webview-ui/agent-manager/terminal/state"
import type { ExtensionMessage } from "../../webview-ui/src/types/messages/extension-messages"

const font = { fontFamily: "Menlo", fontSize: 12 }

function scene(initial: string | null = LOCAL) {
  const [selection, setSelection] = createSignal<string | null>(initial)
  const state = createTerminalState(selection)
  const posted: Array<Record<string, unknown>> = []
  const events = {
    activated: [] as string[],
    selected: [] as string[],
    saved: 0,
    shown: [] as string[],
    errors: 0,
    running: [] as Array<{ contextKey: string; terminalId: string }>,
    sideFocus: [] as boolean[],
  }
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
    onSideCreated: (_contextKey, _terminalId, focus) => events.sideFocus.push(focus),
    onScriptRunning: (contextKey, terminalId) => events.running.push({ contextKey, terminalId }),
  })
  return { state, selection, setSelection, posted, events, handlers, dispatch }
}

function createdSide(createId: string, terminalId: string, title = "Terminal 1", worktreeId: string | null = null) {
  return {
    type: "agentManager.terminal.created",
    createId,
    placement: "side",
    worktreeId,
    terminalId,
    title,
    wsUrl: `ws://${terminalId}`,
    font,
  } satisfies ExtensionMessage
}

function script(
  terminalId: string,
  state: "running" | "stopping" | "exited" | "failed" = "running",
  exitCode?: number,
) {
  return {
    type: "agentManager.scriptTerminals",
    terminals: [
      {
        terminalId,
        worktreeId: null,
        kind: "run",
        title: "Run",
        wsUrl: `ws://${terminalId}`,
        state,
        ...(exitCode === undefined ? {} : { exitCode }),
        font,
      },
    ],
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

  it("hydrates complete Run snapshots without create ids and preserves mounted terminal records", () => {
    createRoot((dispose) => {
      const item = scene()
      item.state.add(null, { id: "terminal:user", title: "Terminal 1", wsUrl: "ws://user", font, placement: "side" })
      const user = item.state.sidesForContext(LOCAL)[0]!

      expect(item.dispatch(script("script:run"))).toBe(true)
      const run = item.state.sidesForContext(LOCAL).find((term) => term.id === "script:run")
      expect(run).toMatchObject({ title: "Run", placement: "side", kind: "run", contextKey: LOCAL })
      expect(item.events.running).toEqual([{ contextKey: LOCAL, terminalId: "script:run" }])
      expect(item.state.scriptStatus("script:run")).toEqual({ state: "running", kind: "run" })
      expect(isTerminalTabId("script:run")).toBe(true)

      item.state.setTitle("script:run", "npm test")
      expect(item.state.title("script:run")).toBe("Run")

      item.dispatch(script("script:run", "exited", 0))
      expect(item.state.sidesForContext(LOCAL).find((term) => term.id === "script:run")).toBe(run)
      expect(item.state.scriptStatus("script:run")).toEqual({ state: "exited", exitCode: 0, kind: "run" })
      expect(item.state.sidesForContext(LOCAL).find((term) => term.id === "terminal:user")).toBe(user)
      // Existing snapshots update status only; they do not re-open the inspector.
      expect(item.events.running).toEqual([{ contextKey: LOCAL, terminalId: "script:run" }])

      item.dispatch({ type: "agentManager.scriptTerminals", terminals: [] } satisfies ExtensionMessage)
      expect(item.state.sidesForContext(LOCAL)).toEqual([user])
      expect(item.state.scriptStatus("script:run")).toBeUndefined()
      dispose()
    })
  })

  it("maps Local Run snapshots to LOCAL and does not reveal exited terminals", () => {
    createRoot((dispose) => {
      const item = scene()
      item.dispatch(script("script:exit", "exited", 2))

      expect(item.state.sidesForContext(LOCAL)[0]).toMatchObject({ id: "script:exit", contextKey: LOCAL })
      expect(item.events.running).toEqual([])
      dispose()
    })
  })

  it("hydrates Setup snapshots with their semantic title and kind", () => {
    createRoot((dispose) => {
      const item = scene()
      item.dispatch({
        type: "agentManager.scriptTerminals",
        terminals: [
          {
            terminalId: "script:setup",
            worktreeId: "wt-1",
            kind: "setup",
            title: "Setup",
            wsUrl: "ws://script:setup",
            state: "running",
            font,
          },
        ],
      } satisfies ExtensionMessage)

      const setup = item.state.sidesForContext("wt-1").find((term) => term.id === "script:setup")
      expect(setup).toMatchObject({ title: "Setup", placement: "side", kind: "setup", contextKey: "wt-1" })
      expect(item.events.running).toEqual([{ contextKey: "wt-1", terminalId: "script:setup" }])
      expect(item.state.scriptStatus("script:setup")).toEqual({ state: "running", kind: "setup" })
      expect(item.state.isScript("script:setup")).toBe(true)

      item.state.setTitle("script:setup", "bash")
      expect(item.state.title("script:setup")).toBe("Setup")

      item.dispatch({ type: "agentManager.scriptTerminals", terminals: [] } satisfies ExtensionMessage)
      expect(item.state.sidesForContext("wt-1")).toEqual([])
      expect(item.state.scriptStatus("script:setup")).toBeUndefined()
      dispose()
    })
  })

  it("hydrates script terminals into independent project contexts", () => {
    createRoot((dispose) => {
      const item = scene()
      item.dispatch({
        type: "agentManager.scriptTerminals",
        terminals: [
          {
            terminalId: "script:setup-a",
            projectId: "prj-a",
            worktreeId: "wt-1",
            kind: "setup",
            title: "Setup",
            wsUrl: "ws://script:setup-a",
            state: "running",
            font,
          },
          {
            terminalId: "script:setup-b",
            projectId: "prj-b",
            worktreeId: "wt-1",
            kind: "setup",
            title: "Setup",
            wsUrl: "ws://script:setup-b",
            state: "running",
            font,
          },
        ],
      } satisfies ExtensionMessage)

      expect(item.state.sidesForContext("prj-a:wt-1").map((term) => term.id)).toEqual(["script:setup-a"])
      expect(item.state.sidesForContext("prj-b:wt-1").map((term) => term.id)).toEqual(["script:setup-b"])
      expect(item.events.running).toEqual([
        { contextKey: "prj-a:wt-1", terminalId: "script:setup-a" },
        { contextKey: "prj-b:wt-1", terminalId: "script:setup-b" },
      ])
      dispose()
    })
  })

  it("activates a Setup terminal that hydrates before its worktree is selected", () => {
    createRoot((dispose) => {
      const item = scene(LOCAL)
      item.dispatch({
        type: "agentManager.scriptTerminals",
        terminals: [
          {
            terminalId: "script:setup-background",
            worktreeId: "wt-background",
            kind: "setup",
            title: "Setup",
            wsUrl: "ws://script:setup-background",
            state: "running",
            font,
          },
        ],
      } satisfies ExtensionMessage)

      expect(item.state.sideActiveFor("wt-background")).toBe("script:setup-background")
      expect(item.events.running).toEqual([{ contextKey: "wt-background", terminalId: "script:setup-background" }])
      dispose()
    })
  })

  it("does not replace an existing side-terminal selection during background hydration", () => {
    createRoot((dispose) => {
      const item = scene(LOCAL)
      item.dispatch({
        type: "agentManager.scriptTerminals",
        terminals: [
          {
            terminalId: "script:run-background",
            worktreeId: "wt-background",
            kind: "run",
            title: "Run",
            wsUrl: "ws://script:run-background",
            state: "running",
            font,
          },
        ],
      } satisfies ExtensionMessage)
      item.state.setSideActive("wt-background", "script:run-background")

      item.dispatch({
        type: "agentManager.scriptTerminals",
        terminals: [
          {
            terminalId: "script:run-background",
            worktreeId: "wt-background",
            kind: "run",
            title: "Run",
            wsUrl: "ws://script:run-background",
            state: "running",
            font,
          },
          {
            terminalId: "script:setup-background",
            worktreeId: "wt-background",
            kind: "setup",
            title: "Setup",
            wsUrl: "ws://script:setup-background",
            state: "running",
            font,
          },
        ],
      } satisfies ExtensionMessage)

      expect(item.state.sideActiveFor("wt-background")).toBe("script:run-background")
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

  it("ensures a side terminal without revealing the panel", () => {
    createRoot((dispose) => {
      const item = scene("wt-1")
      item.handlers.ensureSide()
      item.handlers.ensureSide()

      expect(item.events.shown).toEqual([])
      expect(item.posted).toHaveLength(1)
      expect(item.posted[0]).toMatchObject({
        type: "agentManager.terminal.create",
        placement: "side",
        worktreeId: "wt-1",
      })
      const createId = String(item.posted[0]!.createId)
      expect(item.dispatch(createdSide(createId, "terminal:side", "Terminal 1", "wt-1"))).toBe(true)
      expect(item.events.sideFocus).toEqual([false])
      dispose()
    })
  })

  it("focuses a side terminal only when the user explicitly opens it", () => {
    createRoot((dispose) => {
      const item = scene()
      item.handlers.addSide()
      const createId = String(item.posted[0]!.createId)
      expect(item.dispatch(createdSide(createId, "terminal:side"))).toBe(true)
      expect(item.events.sideFocus).toEqual([true])
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

  it("keeps only the target side terminal on close others", () => {
    createRoot((dispose) => {
      const item = scene()
      item.state.add(null, { id: "terminal:one", title: "Terminal 1", wsUrl: "ws://one", font, placement: "side" })
      item.state.add(null, { id: "terminal:two", title: "Terminal 2", wsUrl: "ws://two", font, placement: "side" })
      item.state.add(null, { id: "terminal:three", title: "Terminal 3", wsUrl: "ws://three", font, placement: "side" })
      // Another context must survive untouched: "others" is per context.
      item.state.add("wt-1", { id: "terminal:other", title: "Other", wsUrl: "ws://other", font, placement: "side" })
      item.state.setSideActive(LOCAL, "terminal:one")

      item.handlers.closeSideOthers("terminal:two")
      expect(item.state.sidesForContext(LOCAL).map((term) => term.id)).toEqual(["terminal:two"])
      expect(item.state.sidesForContext("wt-1").map((term) => term.id)).toEqual(["terminal:other"])
      // The survivor becomes visible and focused, like selecting its tab.
      expect(item.state.sideActiveFor(LOCAL)).toBe("terminal:two")
      expect(item.state.focusRequest()?.id).toBe("terminal:two")
      expect(item.posted).toEqual([
        { type: "agentManager.terminal.close", terminalId: "terminal:one" },
        { type: "agentManager.terminal.close", terminalId: "terminal:three" },
      ])
      dispose()
    })
  })

  it("waits for Run closure confirmation while user terminal closes stay optimistic", () => {
    createRoot((dispose) => {
      const item = scene()
      item.state.add(null, { id: "terminal:user", title: "Terminal 1", wsUrl: "ws://user", font, placement: "side" })
      item.dispatch(script("script:run"))

      expect(item.handlers.closeSide("script:run")).toBe(true)
      expect(item.state.sidesForContext(LOCAL).map((term) => term.id)).toEqual(["terminal:user", "script:run"])
      expect(item.posted).toEqual([{ type: "agentManager.terminal.close", terminalId: "script:run" }])

      expect(item.handlers.closeSide("terminal:user")).toBe(true)
      expect(item.state.sidesForContext(LOCAL).map((term) => term.id)).toEqual(["script:run"])
      expect(item.posted).toEqual([
        { type: "agentManager.terminal.close", terminalId: "script:run" },
        { type: "agentManager.terminal.close", terminalId: "terminal:user" },
      ])
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

  // Multi-project regression: AgentManagerApp feeds createTerminalState a
  // project-namespaced selection accessor (`${projectId}:${sel}`) so ids
  // from different projects never collide. The wire protocol still speaks
  // plain worktree ids, and `terminal.created` carries the owning
  // `projectId` so the answer lands back in the namespaced context.
  function nsScene(initial: string | null = LOCAL, pid = "prj-1") {
    const [selection, setSelection] = createSignal<string | null>(initial)
    const ns = (sel: string) => `${pid}:${sel}`
    const state = createTerminalState(() => {
      const sel = selection()
      return sel === null ? null : ns(sel)
    })
    const posted: Array<Record<string, unknown>> = []
    const events = { activated: [] as string[], selected: [] as string[], created: [] as string[] }
    const handlers = createTerminalHandlers({
      state,
      tabIds: () => state.current().map((term) => term.id),
      selectReview: () => undefined,
      selectSessionTab: () => undefined,
      clearSession: () => undefined,
      resetOthers: () => undefined,
      isPendingId: () => false,
      findTab: () => undefined,
      postMessage: (message) => posted.push(message as Record<string, unknown>),
      onShowSide: () => undefined,
      getSelection: selection,
      LOCAL,
      REVIEW_TAB_ID: "review",
    })
    const dispatch = createTerminalMessageHandler({
      state,
      activate: (id) => events.activated.push(id),
      saveTabMemory: () => undefined,
      setSelection: (value) => events.selected.push(value),
      showError: () => undefined,
      postMessage: (message) => posted.push(message as Record<string, unknown>),
      onCreated: (contextKey) => events.created.push(contextKey),
    })
    return { state, posted, events, handlers, dispatch, ns }
  }

  it("keeps the namespaced state key out of side creates and buckets project-stamped answers", () => {
    createRoot((dispose) => {
      const item = nsScene(LOCAL)
      item.handlers.requestSide()

      expect(item.posted).toHaveLength(1)
      const request = item.posted[0]!
      expect(request).toMatchObject({ type: "agentManager.terminal.create", placement: "side", worktreeId: null })
      expect(item.dispatch({ ...createdSide(String(request.createId), "terminal:side"), projectId: "prj-1" })).toBe(
        true,
      )
      expect(item.state.sideKey()).toBe("prj-1:local")
      expect(item.state.sides().map((term) => term.id)).toEqual(["terminal:side"])
      expect(item.state.sideActiveFor("prj-1:local")).toBe("terminal:side")

      // A worktree context sends its plain worktree id, not "prj-1:wt-1".
      const wt = nsScene("wt-1")
      wt.handlers.addSide()
      expect(wt.posted[0]).toMatchObject({
        type: "agentManager.terminal.create",
        placement: "side",
        worktreeId: "wt-1",
      })
      dispose()
    })
  })

  it("buckets project-stamped tab terminals under the namespaced context", () => {
    createRoot((dispose) => {
      const item = nsScene(LOCAL)
      item.handlers.requestNew()
      expect(item.posted[0]).toMatchObject({
        type: "agentManager.terminal.create",
        placement: "tab",
        worktreeId: null,
      })
      const created: ExtensionMessage = {
        type: "agentManager.terminal.created",
        createId: String(item.posted[0]!.createId),
        placement: "tab",
        worktreeId: null,
        projectId: "prj-1",
        terminalId: "terminal:tab",
        title: "Terminal 1",
        wsUrl: "ws://tab",
        font,
      }
      expect(item.dispatch(created)).toBe(true)
      expect(item.state.current().map((term) => term.id)).toEqual(["terminal:tab"])
      // Selection and tab order stay on the plain protocol id.
      expect(item.events.selected).toEqual([LOCAL])
      expect(item.events.created).toEqual([LOCAL])
      expect(item.events.activated).toEqual(["terminal:tab"])
      dispose()
    })
  })
})
