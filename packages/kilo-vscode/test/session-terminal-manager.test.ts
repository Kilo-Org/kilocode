import { describe, expect, it } from "bun:test"
import {
  SessionTerminalManager,
  type Disposable,
  type TerminalHandle,
  type TerminalHost,
} from "../src/agent-manager/SessionTerminalManager"

function harness() {
  const shown: Array<{ name: string; preserveFocus: boolean }> = []
  const handles: TerminalHandle[] = []
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const host: TerminalHost = {
    createTerminal: ({ name }) => {
      const handle: TerminalHandle = {
        show: (preserveFocus) => shown.push({ name, preserveFocus }),
        dispose: () => undefined,
        exitStatus: undefined,
      }
      handles.push(handle)
      return handle
    },
    activeTerminal: () => handles.at(-1),
    repoPath: () => "/repo",
    showWarning: () => undefined,
    setContext: () => undefined,
    onTerminalClosed: () => ({ dispose: () => undefined }) as Disposable,
    onActiveTerminalChanged: () => ({ dispose: () => undefined }) as Disposable,
    registerCommand: (id, handler) => {
      handlers.set(id, handler)
      return { dispose: () => void handlers.delete(id) }
    },
    executeCommand: async () => undefined,
  }
  const manager = new SessionTerminalManager(() => undefined, host)
  return { manager, shown, handlers }
}

describe("Agent Manager session terminal", () => {
  it("reveals the session terminal on switch while the panel is open", () => {
    const test = harness()
    test.manager.showTerminal("ses_1", undefined)
    test.shown.length = 0

    expect(test.manager.syncOnSessionSwitch("ses_1")).toBe(true)
    expect(test.shown).toEqual([{ name: "Agent: local", preserveFocus: true }])
    test.manager.dispose()
  })

  it("does not reveal a terminal while the panel is hidden", async () => {
    const test = harness()
    test.manager.showTerminal("ses_1", undefined)
    test.shown.length = 0

    await test.handlers.get("workbench.action.closePanel")?.()
    expect(test.manager.syncOnSessionSwitch("ses_1")).toBe(false)
    expect(test.shown).toEqual([])
    test.manager.dispose()
  })

  it("reports no terminal for a session that has none", () => {
    const test = harness()
    expect(test.manager.syncOnSessionSwitch("ses_2")).toBe(false)
    test.manager.dispose()
  })
})