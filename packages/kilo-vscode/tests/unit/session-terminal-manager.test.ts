/**
 * SessionTerminalManager tests.
 *
 * The class is tightly coupled to VS Code terminal APIs. We use ts-morph
 * static analysis to verify structural invariants that protect against
 * real regressions — focusing on ordering constraints and cleanup logic
 * that are easy to break during refactoring.
 */

import { describe, it, expect } from "bun:test"
import path from "node:path"
import { Project, SyntaxKind } from "ts-morph"

const ROOT = path.resolve(import.meta.dir, "../..")
const FILE = path.join(ROOT, "src/agent-manager/SessionTerminalManager.ts")

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
    expect(text).toContain("onDidCloseTerminal")
    expect(text).toContain("onDidChangeActiveTerminal")
  })

  it("dispose clears the context key, disposes terminals, and clears the map", () => {
    const text = body("dispose")
    // All three are required for clean shutdown — missing any would leak resources
    expect(text).toContain("kilo-code.agentTerminalFocus")
    expect(text).toContain("terminal.dispose()")
    expect(text).toContain("terminals.clear()")
  })

  it("showTerminal resolves CWD from worktree with workspace fallback", () => {
    const text = body("showTerminal")
    // The fallback chain must be worktreePath ?? workspacePath, not the reverse.
    // Getting this wrong would run agents in the wrong directory.
    expect(text).toContain("worktreePath ?? workspacePath")
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
})
