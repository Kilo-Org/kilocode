import { describe, expect, it } from "bun:test"
import {
  createSideTerminal,
  readSavedDestination,
  resolveVscodeTerminalRequest,
} from "../../webview-ui/agent-manager/terminal/side"

function scene(
  opts: {
    destination?: "vscode" | "agentManager"
    saved?: "vscode" | "agentManager"
    visible?: boolean
    focusedId?: string
  } = {},
) {
  const calls = {
    requestSide: 0,
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
      },
      closeSide: (terminalId) => {
        calls.closed.push(terminalId)
        focusedId = undefined
        return true
      },
    },
    visible: () => visible,
    focusedId: () => focusedId,
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
  })
  if (opts.destination) ctl.syncDefault(opts.destination)
  return { ctl, calls }
}

describe("Agent Manager side terminal controller", () => {
  it("toggles the panel and hands focus to the chat only when the terminal had it", () => {
    const focused = scene({ destination: "agentManager", visible: true, focusedId: "terminal:side" })
    focused.ctl.toggle()
    expect(focused.calls.hide).toBe(1)
    expect(focused.calls.refocus).toBe(1)

    const elsewhere = scene({ destination: "agentManager", visible: true })
    elsewhere.ctl.toggle()
    expect(elsewhere.calls.hide).toBe(1)
    expect(elsewhere.calls.refocus).toBe(0)

    const hidden = scene({ destination: "agentManager", visible: false })
    hidden.ctl.toggle()
    expect(hidden.calls.requestSide).toBe(1)
    expect(hidden.calls.hide).toBe(0)
  })

  it("kills the focused terminal and refocuses the chat", () => {
    const focused = scene({ focusedId: "terminal:two" })
    expect(focused.ctl.close()).toBe(true)
    expect(focused.calls.closed).toEqual(["terminal:two"])
    expect(focused.calls.refocus).toBe(1)
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

  it("persists the picked destination with a section-relative settings key", () => {
    const item = scene()
    item.ctl.choose("agentManager")
    expect(item.ctl.destination()).toBe("agentManager")
    expect(item.calls.posted).toEqual([
      { type: "updateSetting", key: "agentManager.terminalButtonDestination", value: "agentManager" },
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
