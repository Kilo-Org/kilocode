/**
 * SessionTerminalManager tests.
 *
 * Structural tests use ts-morph to protect ordering and cleanup invariants.
 * Command behavior tests exercise the narrow TerminalHost interface directly.
 */

import { describe, it, expect } from "bun:test"
import path from "node:path"
import { Project, SyntaxKind } from "ts-morph"
import { SessionTerminalManager, type TerminalHost } from "../../src/agent-manager/SessionTerminalManager"

const ROOT = path.resolve(import.meta.dir, "../..")
const FILE = path.join(ROOT, "src/agent-manager/SessionTerminalManager.ts")
const COMMAND = "workbench.action.togglePanel"

type Handler = (...args: unknown[]) => Promise<unknown>

function runtime(run: () => Promise<unknown>) {
  let blocked = false
  const handlers = new Map<string, Handler>()
  const host: TerminalHost = {
    createTerminal() {
      throw new Error("not used")
    },
    activeTerminal: () => undefined,
    repoPath: () => undefined,
    showWarning() {},
    setContext() {},
    onTerminalClosed: () => ({ dispose() {} }),
    onActiveTerminalChanged: () => ({ dispose() {} }),
    registerCommand(id, handler) {
      if (blocked && id === COMMAND) throw new Error(`command '${id}' already exists`)
      handlers.set(id, handler)
      return {
        dispose() {
          if (handlers.get(id) === handler) handlers.delete(id)
        },
      }
    },
    executeCommand() {
      blocked = true
      return run()
    },
  }
  const manager = new SessionTerminalManager(() => {}, host)
  const handler = handlers.get(COMMAND)
  if (!handler) throw new Error(`command '${COMMAND}' was not registered`)
  return { manager, handler }
}

function getClass() {
  const project = new Project({ compilerOptions: { allowJs: true } })
  const source = project.addSourceFileAtPath(FILE)
  return source.getFirstDescendantByKind(SyntaxKind.ClassDeclaration)!
}

function body(name: string): string {
  const cls = getClass()
  const method = cls.getMethod(name)
  expect(method, `method ${name} not found in SessionTerminalManager`).toBeTruthy()
  return method!.getText()
}

describe("SessionTerminalManager structure", () => {
  it("constructor registers both terminal lifecycle listeners", () => {
    const cls = getClass()
    const ctor = cls.getConstructors()[0]
    expect(ctor).toBeTruthy()
    const text = ctor!.getText()
    // Both listeners are required: close (cleanup) and active-change (context key)
    expect(text).toContain("onTerminalClosed")
    expect(text).toContain("onActiveTerminalChanged")
  })

  it("dispose clears the context key, disposes terminals, and clears the map", () => {
    const text = body("dispose")
    // All three are required for clean shutdown — missing any would leak resources
    expect(text).toContain("kilo-code.agentTerminalFocus")
    expect(text).toContain("terminal.dispose()")
    expect(text).toContain("terminals.clear()")
  })

  it("showTerminal resolves CWD from worktree with repo fallback", () => {
    const text = body("showTerminal")
    // The fallback chain must be worktreePath ?? repoPath, not the reverse.
    // Getting this wrong would run agents in the wrong directory.
    expect(text).toContain("worktreePath ?? repoPath")
  })

  /**
   * Regression: showOrCreate must check exitStatus before checking CWD changes.
   * If reversed, a stale exited terminal with a different CWD would hit the
   * dispose path instead of the cleanup path, potentially leaving ghost entries.
   */
  it("showOrCreate checks exit status before CWD mismatch", () => {
    const text = body("showOrCreate")
    const exitIdx = text.indexOf("exitStatus")
    const cwdIdx = text.indexOf("entry.cwd !== cwd")
    expect(exitIdx).toBeGreaterThan(-1)
    expect(cwdIdx).toBeGreaterThan(-1)
    expect(exitIdx, "exit check must come before cwd check").toBeLessThan(cwdIdx)
  })

  it("showOrCreate updates context key after showing terminal", () => {
    const text = body("showOrCreate")
    const showIdx = text.lastIndexOf("entry.terminal.show")
    const contextIdx = text.lastIndexOf("this.updateContextKey()")
    expect(showIdx).toBeGreaterThan(-1)
    expect(contextIdx).toBeGreaterThan(-1)
    expect(showIdx, "show must precede updateContextKey").toBeLessThan(contextIdx)
  })

  it("syncOnSessionSwitch only switches when panel is open", () => {
    const text = body("syncOnSessionSwitch")
    expect(text).toContain("if (!this.panelOpen)")
    expect(text).toContain("this.showExisting(sessionId)")
  })

  it("syncLocalOnSessionSwitch only switches when panel is open", () => {
    const text = body("syncLocalOnSessionSwitch")
    expect(text).toContain("if (!this.panelOpen)")
    expect(text).toContain("this.showExistingLocal()")
  })

  it("panel command registration is best effort", () => {
    const text = body("tryRegisterCommand")
    expect(text).toContain("this.host.registerCommand")
    expect(text).toContain("catch (err)")
    expect(text).toContain("panel command registration skipped")
  })

  it("exposes active terminal state for terminal context routing", () => {
    const text = body("hasActiveTerminal")
    expect(text).toContain("this.host.activeTerminal()")
  })
})

describe("SessionTerminalManager command restoration", () => {
  it("preserves the original command result when re-registration fails", async () => {
    const expected = { status: "complete" }
    const state = runtime(async () => expected)

    expect(await state.handler()).toBe(expected)
    state.manager.dispose()
  })

  it("preserves the original command error when re-registration fails", async () => {
    const expected = new Error("panel command failed")
    const state = runtime(async () => {
      throw expected
    })

    await expect(state.handler()).rejects.toBe(expected)
    state.manager.dispose()
  })
})
