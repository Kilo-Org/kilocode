import { describe, expect, it } from "bun:test"
import {
  createSideTerminal,
  readSavedDestination,
  resolveRunScriptRequest,
  resolveVscodeTerminalRequest,
} from "../../webview-ui/agent-manager/terminal/side"

function scene(
  opts: {
    destination?: "vscode" | "agentManager"
    saved?: "vscode" | "agentManager"
    visible?: boolean
    focusedId?: string
    count?: number
    script?: boolean
    mac?: boolean
  } = {},
) {
  const calls = {
    requestSide: 0,
    ensureSide: 0,
    closed: [] as string[],
    hide: 0,
    refocus: 0,
    openVscode: 0,
    persisted: [] as string[],
    posted: [] as Array<Record<string, unknown>>,
    tracked: [] as string[],
  }
  let visible = opts.visible ?? false
  let focusedId = opts.focusedId as string | undefined
  const ctl = createSideTerminal({
    handlers: {
      requestSide: () => {
        calls.requestSide++
        visible = true
        focusedId ??= "terminal:side"
      },
      ensureSide: () => calls.ensureSide++,
      closeSide: (terminalId) => {
        calls.closed.push(terminalId)
        focusedId = undefined
        return true
      },
    },
    visible: () => visible,
    focusedId: () => focusedId,
    count: () => opts.count ?? 2,
    isScript: () => opts.script ?? false,
    hide: () => {
      calls.hide++
      visible = false
    },
    refocus: () => calls.refocus++,
    postMessage: (msg) => calls.posted.push(msg as Record<string, unknown>),
    track: (button) => calls.tracked.push(button),
    openVscode: () => calls.openVscode++,
    saved: opts.saved,
    save: (destination) => calls.persisted.push(destination),
    mac: opts.mac,
  })
  if (opts.destination) ctl.syncDefault(opts.destination)
  return { ctl, calls }
}

describe("Agent Manager side terminal controller", () => {
  it("toggles the panel, focusing a visible terminal before hiding it", () => {
    const focused = scene({ destination: "agentManager", visible: true, focusedId: "terminal:side" })
    focused.ctl.toggle()
    expect(focused.calls.hide).toBe(1)
    expect(focused.calls.refocus).toBe(1)

    const elsewhere = scene({ destination: "agentManager", visible: true })
    elsewhere.ctl.toggle()
    expect(elsewhere.calls.requestSide).toBe(1)
    expect(elsewhere.calls.hide).toBe(0)
    expect(elsewhere.calls.refocus).toBe(0)

    const hidden = scene({ destination: "agentManager", visible: false })
    hidden.ctl.toggle()
    expect(hidden.calls.requestSide).toBe(1)
    expect(hidden.calls.hide).toBe(0)
  })

  it("ensures an open terminal panel has a terminal after switching contexts", async () => {
    const visible = scene({ visible: true })
    visible.ctl.syncContext("wt-2", "wt-1")
    await Promise.resolve()
    expect(visible.calls.ensureSide).toBe(1)

    visible.ctl.syncContext("wt-2", "wt-2")
    visible.ctl.syncContext("wt-2", undefined)
    await Promise.resolve()
    expect(visible.calls.ensureSide).toBe(2)
    expect(visible.calls.requestSide).toBe(0)

    const hidden = scene()
    hidden.ctl.syncContext("wt-2", "wt-1")
    expect(hidden.calls.ensureSide).toBe(0)

    const closed = scene({ visible: true, focusedId: "terminal:side" })
    closed.ctl.syncContext("wt-2", "wt-1")
    closed.ctl.toggle()
    await Promise.resolve()
    expect(closed.calls.ensureSide).toBe(0)
  })

  it("closes the focused terminal without stealing focus from its survivor", () => {
    const focused = scene({ focusedId: "terminal:two" })
    expect(focused.ctl.close()).toBe(true)
    expect(focused.calls.closed).toEqual(["terminal:two"])
    expect(focused.calls.refocus).toBe(0)
  })

  it("hides instead of killing the last or provider-owned terminal", () => {
    const last = scene({ focusedId: "terminal:last", count: 1 })
    expect(last.ctl.close()).toBe(true)
    expect(last.calls.closed).toEqual([])
    expect(last.calls.hide).toBe(1)
    expect(last.calls.refocus).toBe(1)

    const script = scene({ focusedId: "script:run", script: true, count: 2 })
    expect(script.ctl.close()).toBe(true)
    expect(script.calls.closed).toEqual([])
    expect(script.calls.hide).toBe(1)
    expect(script.calls.refocus).toBe(1)
  })

  it("does nothing on close without a focused terminal", () => {
    const item = scene()
    expect(item.ctl.close()).toBe(false)
    expect(item.calls.closed).toEqual([])
    expect(item.calls.refocus).toBe(0)
  })

  it("routes the primary action by destination", () => {
    const vscodeFirst = scene({ destination: "vscode" })
    vscodeFirst.ctl.openPreferred("tab_toolbar")
    expect(vscodeFirst.calls.openVscode).toBe(1)
    expect(vscodeFirst.calls.requestSide).toBe(0)

    const panelFirst = scene({ destination: "agentManager" })
    panelFirst.ctl.openPreferred("keyboard_shortcut")
    expect(panelFirst.calls.requestSide).toBe(1)
    expect(panelFirst.calls.openVscode).toBe(0)
  })

  it("handles the platform terminal shortcut locally and dedupes the extension echo", () => {
    const press = (opts: Partial<KeyboardEvent> = {}) =>
      ({ key: "/", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...opts }) as KeyboardEvent

    // macOS: the workbench binding is Cmd+/, so only Cmd is accepted.
    const mac = scene({ destination: "agentManager", mac: true })
    expect(mac.ctl.press(press({ metaKey: true }))).toBe(true)
    expect(mac.calls.requestSide).toBe(1)
    expect(mac.ctl.press(press({ ctrlKey: true }))).toBe(false)
    expect(mac.ctl.press(press({ metaKey: true, ctrlKey: true }))).toBe(false)
    expect(mac.calls.requestSide).toBe(1)

    // Windows/Linux: the workbench binding is Ctrl+/, so only Ctrl is accepted.
    const win = scene({ destination: "agentManager", mac: false })
    expect(win.ctl.press(press({ ctrlKey: true }))).toBe(true)
    expect(win.calls.requestSide).toBe(1)
    expect(win.ctl.press(press({ metaKey: true }))).toBe(false)
    expect(win.calls.requestSide).toBe(1)

    // Unrelated keys and modifier combinations are not the shortcut.
    expect(win.ctl.press(press({ key: "?" }))).toBe(false)
    expect(win.ctl.press(press({ ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(win.ctl.press(press({ ctrlKey: true, altKey: true }))).toBe(false)
    expect(win.calls.requestSide).toBe(1)

    // The extension echoes each locally handled keypress back as an action
    // message; one echo is consumed per press, then invocations run again.
    expect(mac.ctl.echo()).toBe(true)
    expect(mac.ctl.echo()).toBe(false)
  })

  it("consumes one echo per press, even for rapid repeated presses", () => {
    const item = scene({ destination: "agentManager", mac: true })
    const press = () => item.ctl.press({ key: "/", metaKey: true } as KeyboardEvent)
    press()
    press()
    // Two presses toggled the panel open and closed again; both echoes
    // must still be consumed so neither press toggles a third time.
    expect(item.calls.requestSide).toBe(1)
    expect(item.calls.hide).toBe(1)
    expect(item.ctl.echo()).toBe(true)
    expect(item.ctl.echo()).toBe(true)
    expect(item.ctl.echo()).toBe(false)
  })

  it("drops a never-arriving echo after the timeout safety valve", async () => {
    const item = scene({ destination: "agentManager", mac: true })
    item.ctl.press({ key: "/", metaKey: true } as KeyboardEvent)
    await new Promise((resolve) => setTimeout(resolve, 550))
    expect(item.ctl.echo()).toBe(false)
    expect(item.ctl.echo()).toBe(false)
  })

  it("expires a dropped echo's backlog at the next spaced press", async () => {
    const item = scene({ destination: "agentManager", mac: true })
    // First press's echo never arrives (dropped forwarding); its backlog
    // must not outlive the echo window into the next press.
    item.ctl.press({ key: "/", metaKey: true } as KeyboardEvent)
    await new Promise((resolve) => setTimeout(resolve, 550))
    item.ctl.press({ key: "/", metaKey: true } as KeyboardEvent)
    expect(item.ctl.echo()).toBe(true)
    expect(item.ctl.echo()).toBe(false)
  })

  it("persists the picked destination with a section-relative settings key", () => {
    const item = scene()
    item.ctl.choose("agentManager")
    expect(item.ctl.destination()).toBe("agentManager")
    expect(item.calls.posted).toEqual([
      { type: "agentManager.terminal.destinationSelected", destination: "agentManager" },
    ])
    expect(item.calls.persisted).toEqual(["agentManager"])
  })

  it("follows the remote default while the panel has no explicit choice", () => {
    const item = scene()
    item.ctl.syncDefault("agentManager")
    expect(item.ctl.destination()).toBe("agentManager")
    item.ctl.syncDefault("vscode")
    expect(item.ctl.destination()).toBe("vscode")
  })

  it("keeps the panel's explicit choice when another window rewrites the shared setting", () => {
    const item = scene()
    item.ctl.choose("agentManager")
    // Echo of the application-scoped setting being rewritten elsewhere:
    // worktree window B picked the VS Code terminal, which must not flip
    // this panel's routing.
    item.ctl.syncDefault("vscode")
    expect(item.ctl.destination()).toBe("agentManager")
    item.ctl.openPreferred("keyboard_shortcut")
    expect(item.calls.requestSide).toBe(1)
    expect(item.calls.openVscode).toBe(0)
  })

  it("restores a saved panel choice and ignores remote defaults", () => {
    const item = scene({ saved: "agentManager" })
    expect(item.ctl.destination()).toBe("agentManager")
    expect(item.calls.posted).toEqual([
      { type: "agentManager.terminal.destinationSelected", destination: "agentManager" },
    ])
    item.ctl.syncDefault("vscode")
    expect(item.ctl.destination()).toBe("agentManager")
  })
})

describe("readSavedDestination", () => {
  it("reads a valid choice and rejects anything else", () => {
    expect(readSavedDestination({ terminalDestination: "agentManager" })).toBe("agentManager")
    expect(readSavedDestination({ terminalDestination: "vscode" })).toBe("vscode")
    expect(readSavedDestination({ terminalDestination: "bogus" })).toBeUndefined()
    expect(readSavedDestination({})).toBeUndefined()
    expect(readSavedDestination(undefined)).toBeUndefined()
  })
})

describe("resolveRunScriptRequest", () => {
  it("carries the current panel dropdown destination with every Run request", () => {
    expect(resolveRunScriptRequest("wt-1", "agentManager")).toEqual({
      type: "agentManager.runScript",
      worktreeId: "wt-1",
      destination: "agentManager",
    })
    expect(resolveRunScriptRequest("local", "vscode")).toEqual({
      type: "agentManager.runScript",
      worktreeId: "local",
      destination: "vscode",
    })
  })
})

describe("resolveVscodeTerminalRequest", () => {
  const sessions = new Map([
    ["wt-1", "session-a"],
    ["wt-2", "session-b"],
  ])
  const forWorktree = (id: string) => sessions.get(id)

  it("prefers the current session", () => {
    expect(resolveVscodeTerminalRequest("wt-1", "session-current", forWorktree)).toEqual({
      type: "agentManager.showTerminal",
      sessionId: "session-current",
    })
  })

  it("falls back to a session of the selected worktree when the current session is cleared", () => {
    // Terminal tab activation clears the current session; the shortcut
    // must still open a terminal for the worktree, not dead-end.
    expect(resolveVscodeTerminalRequest("wt-2", undefined, forWorktree)).toEqual({
      type: "agentManager.showTerminal",
      sessionId: "session-b",
    })
  })

  it("opens a worktree-rooted terminal for sessionless worktrees", () => {
    expect(resolveVscodeTerminalRequest("wt-3", undefined, forWorktree)).toEqual({
      type: "agentManager.showWorktreeTerminal",
      worktreeId: "wt-3",
    })
  })

  it("opens the local terminal for the local context and unassigned selections", () => {
    expect(resolveVscodeTerminalRequest("local", undefined, forWorktree)).toEqual({
      type: "agentManager.showLocalTerminal",
    })
    expect(resolveVscodeTerminalRequest(null, undefined, forWorktree)).toEqual({
      type: "agentManager.showLocalTerminal",
    })
  })
})
