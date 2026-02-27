/**
 * Architecture tests: Agent Manager
 *
 * The agent manager runs in the same webview context as other UI.
 * All its CSS classes must be prefixed with "am-" to avoid conflicts.
 * These tests also verify consistency between CSS definitions and TSX usage,
 * and that the provider sends correct message types for each action.
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { Project, SyntaxKind } from "ts-morph"

const ROOT = path.resolve(import.meta.dir, "../..")
const KILO_PROVIDER_FILE = path.join(ROOT, "src/KiloProvider.ts")
const CSS_FILE = path.join(ROOT, "webview-ui/agent-manager/agent-manager.css")
const TSX_FILES = [
  path.join(ROOT, "webview-ui/agent-manager/AgentManagerApp.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/sortable-tab.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/DiffPanel.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/FullScreenDiffView.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/FileTree.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/review-annotations.ts"),
  path.join(ROOT, "webview-ui/agent-manager/MultiModelSelector.tsx"),
]
const TSX_FILE = TSX_FILES[0]
const PROVIDER_FILE = path.join(ROOT, "src/agent-manager/AgentManagerProvider.ts")

function readAllTsx(): string {
  return TSX_FILES.map((f) => fs.readFileSync(f, "utf-8")).join("\n")
}

describe("Agent Manager CSS Prefix", () => {
  it("all class selectors should use am- prefix", () => {
    const css = fs.readFileSync(CSS_FILE, "utf-8")
    const matches = [...css.matchAll(/\.([a-z][a-z0-9-]*)/gi)]
    const names = [...new Set(matches.map((m) => m[1]))]

    const invalid = names.filter((n) => !n!.startsWith("am-"))

    expect(invalid, `Classes missing "am-" prefix: ${invalid.join(", ")}`).toEqual([])
  })

  it("all CSS custom properties should use am- prefix", () => {
    const css = fs.readFileSync(CSS_FILE, "utf-8")
    const matches = [...css.matchAll(/--([a-z][a-z0-9-]*)\s*:/gi)]
    const names = [...new Set(matches.map((m) => m[1]))]

    // Allow kilo-ui design tokens, vscode theme variables, and third-party
    // library tokens (@pierre/diffs, kilo-ui sticky-accordion) used as fallbacks
    const allowed = ["am-", "vscode-", "surface-", "text-", "border-", "diffs-", "sticky-", "syntax-"]
    const invalid = names.filter((n) => !allowed.some((p) => n!.startsWith(p)))

    expect(invalid, `CSS properties missing allowed prefix: ${invalid.join(", ")}`).toEqual([])
  })

  it("all @keyframes should use am- prefix", () => {
    const css = fs.readFileSync(CSS_FILE, "utf-8")
    const matches = [...css.matchAll(/@keyframes\s+([a-z][a-z0-9-]*)/gi)]
    const names = matches.map((m) => m[1])

    const invalid = names.filter((n) => !n!.startsWith("am-"))

    expect(invalid, `Keyframes missing "am-" prefix: ${invalid.join(", ")}`).toEqual([])
  })
})

describe("Agent Manager CSS/TSX Consistency", () => {
  it("all classes used in TSX should be defined in CSS", () => {
    const css = fs.readFileSync(CSS_FILE, "utf-8")
    const tsx = readAllTsx()

    // Extract am- classes defined in CSS
    const cssMatches = [...css.matchAll(/\.([a-z][a-z0-9-]*)/gi)]
    const defined = new Set(cssMatches.map((m) => m[1]))

    // Extract am- classes referenced in TSX (class="am-..." or `am-...`)
    const tsxMatches = [...tsx.matchAll(/\bam-[a-z0-9-]+/g)]
    const used = [...new Set(tsxMatches.map((m) => m[0]))]

    const missing = used.filter((c) => !defined.has(c))

    expect(missing, `Classes used in TSX but not defined in CSS: ${missing.join(", ")}`).toEqual([])
  })

  it("all am- classes defined in CSS should be used in TSX", () => {
    const css = fs.readFileSync(CSS_FILE, "utf-8")
    const tsx = readAllTsx()

    // Extract am- classes defined in CSS
    const cssMatches = [...css.matchAll(/\.([a-z][a-z0-9-]*)/gi)]
    const defined = [...new Set(cssMatches.map((m) => m[1]!).filter((n) => n.startsWith("am-")))]

    const unused = defined.filter((c) => !tsx.includes(c!))

    expect(unused, `Classes defined in CSS but not used in TSX: ${unused.join(", ")}`).toEqual([])
  })
})

describe("Agent Manager Provider Messages", () => {
  function getMethodBody(name: string): string {
    const project = new Project({ compilerOptions: { allowJs: true } })
    const source = project.addSourceFileAtPath(PROVIDER_FILE)
    const cls = source.getFirstDescendantByKind(SyntaxKind.ClassDeclaration)
    const method = cls?.getMethod(name)
    expect(method, `method ${name} not found in AgentManagerProvider`).toBeTruthy()
    return method!.getText()
  }

  /**
   * Regression: onAddSessionToWorktree must NOT send agentManager.worktreeSetup
   * because that triggers a full-screen overlay with a spinner. Adding a session
   * to an existing worktree should use agentManager.sessionAdded instead.
   */
  it("onAddSessionToWorktree should not send worktreeSetup messages", () => {
    const body = getMethodBody("onAddSessionToWorktree")
    expect(body).not.toContain("agentManager.worktreeSetup")
  })

  it("onAddSessionToWorktree should send sessionAdded message", () => {
    const body = getMethodBody("onAddSessionToWorktree")
    expect(body).toContain("agentManager.sessionAdded")
  })
})

// ---------------------------------------------------------------------------
// Provider message routing — static-analysis regression tests
//
// These tests use ts-morph to inspect the source code of AgentManagerProvider
// and verify structural invariants that prevent regressions without needing
// a VS Code test host.
// ---------------------------------------------------------------------------

describe("Agent Manager Provider — onMessage routing", () => {
  let source: import("ts-morph").SourceFile
  let cls: import("ts-morph").ClassDeclaration

  function setup() {
    if (source) return
    const project = new Project({ compilerOptions: { allowJs: true } })
    source = project.addSourceFileAtPath(PROVIDER_FILE)
    cls = source.getFirstDescendantByKind(SyntaxKind.ClassDeclaration)!
  }

  function body(name: string): string {
    setup()
    const method = cls.getMethod(name)
    expect(method, `method ${name} not found`).toBeTruthy()
    return method!.getText()
  }

  // -- onMessage dispatches all expected message types -----------------------

  it("onMessage handles all documented agentManager.* message types", () => {
    const text = body("onMessage")
    const expected = [
      "agentManager.createWorktree",
      "agentManager.deleteWorktree",
      "agentManager.promoteSession",
      "agentManager.addSessionToWorktree",
      "agentManager.closeSession",
      "agentManager.configureSetupScript",
      "agentManager.showTerminal",
      "agentManager.showLocalTerminal",
      "agentManager.showExistingLocalTerminal",
      "agentManager.requestRepoInfo",
      "agentManager.requestState",
      "agentManager.setTabOrder",
    ]
    for (const msg of expected) {
      expect(text, `onMessage should handle "${msg}"`).toContain(msg)
    }
  })

  it("onMessage handles loadMessages for terminal switching", () => {
    const text = body("onMessage")
    expect(text).toContain("loadMessages")
    expect(text).toContain("syncOnSessionSwitch")
  })

  it("onMessage handles clearSession for SSE re-registration", () => {
    const text = body("onMessage")
    expect(text).toContain("clearSession")
    expect(text).toContain("trackSession")
  })

  // -- onDeleteWorktree invariants -------------------------------------------

  /**
   * Regression: deletion must clean up both disk (manager) and state, then
   * push to webview. Missing any step leaves ghost worktrees or stale UI.
   */
  it("onDeleteWorktree removes from disk, state, clears orphans, and pushes", () => {
    const text = body("onDeleteWorktree")
    expect(text).toContain("manager.removeWorktree")
    expect(text).toContain("state.removeWorktree")
    expect(text).toContain("clearSessionDirectory")
    expect(text).toContain("this.pushState()")
  })

  // -- onCreateWorktree invariants -------------------------------------------

  /**
   * Regression: the setup script MUST run before session creation.
   * If reversed, the agent starts in an unconfigured worktree (missing .env,
   * deps, etc.) which causes hard-to-debug failures.
   */
  it("onCreateWorktree runs setup script before creating session", () => {
    const text = body("onCreateWorktree")
    const setupIdx = text.indexOf("runSetupScriptForWorktree")
    const sessionIdx = text.indexOf("createSessionInWorktree")
    expect(setupIdx, "setup script call must exist").toBeGreaterThan(-1)
    expect(sessionIdx, "session creation call must exist").toBeGreaterThan(-1)
    expect(setupIdx, "setup script must run before session creation").toBeLessThan(sessionIdx)
  })

  /**
   * Regression: if session creation fails after the worktree was already
   * created on disk, the worktree must be cleaned up to avoid orphaned dirs.
   */
  it("onCreateWorktree cleans up worktree on session creation failure", () => {
    const text = body("onCreateWorktree")
    expect(text).toContain("removeWorktree")
  })

  // -- onPromoteSession invariants -------------------------------------------

  /**
   * Regression: same setup-before-move ordering as onCreateWorktree.
   */
  it("onPromoteSession runs setup script before modifying session", () => {
    const text = body("onPromoteSession")
    const setupIdx = text.indexOf("runSetupScriptForWorktree")
    const moveIdx = text.indexOf("moveSession")
    expect(setupIdx).toBeGreaterThan(-1)
    expect(moveIdx).toBeGreaterThan(-1)
    expect(setupIdx, "setup must run before move").toBeLessThan(moveIdx)
  })

  /**
   * Regression: promote must handle the case where the session doesn't
   * exist in state yet (e.g. a workspace session that was never tracked).
   * It must branch between addSession (new) and moveSession (existing).
   */
  it("onPromoteSession handles both new and existing sessions", () => {
    const text = body("onPromoteSession")
    expect(text).toContain("getSession")
    expect(text).toContain("addSession")
    expect(text).toContain("moveSession")
  })

  // -- notifyWorktreeReady invariants ----------------------------------------

  /**
   * Regression: pushState must come before the ready/meta messages.
   * If reversed, the webview receives the "ready" signal but can't find
   * the worktree/session in state, causing a blank panel.
   */
  it("notifyWorktreeReady pushes state before sending ready message", () => {
    const text = body("notifyWorktreeReady")
    const pushIdx = text.indexOf("this.pushState()")
    const readyIdx = text.indexOf("agentManager.worktreeSetup")
    expect(pushIdx, "pushState must come before worktreeSetup").toBeLessThan(readyIdx)
    // Must also send sessionMeta so the webview knows the branch/path
    expect(text).toContain("agentManager.sessionMeta")
  })

  // -- agentManager.requestState in non-git workspace -------------------------

  /**
   * Regression: when the workspace is not a git repo, this.state is undefined.
   * pushState() silently returns in that case, so requestState must explicitly
   * call pushEmptyState() instead — otherwise the webview stays stuck on
   * loading skeletons forever.
   */
  it("requestState handler calls pushEmptyState when this.state is falsy", () => {
    const text = body("onMessage")
    // Extract the requestState branch
    const start = text.indexOf('"agentManager.requestState"')
    expect(start, "requestState branch must exist").toBeGreaterThan(-1)
    // Grab a reasonable window after the match
    const snippet = text.slice(start, start + 600)
    expect(snippet, "must call pushEmptyState when state is absent").toContain("pushEmptyState")
    expect(snippet, "must guard on this.state being falsy").toMatch(/!this\.state/)
  })

  it("requestState handler calls pushState when this.state is truthy", () => {
    const text = body("onMessage")
    const start = text.indexOf('"agentManager.requestState"')
    const snippet = text.slice(start, start + 600)
    expect(snippet, "must call pushState for the normal path").toContain("this.pushState()")
  })
})

// ---------------------------------------------------------------------------
// Webview — non-git skeleton fix
// ---------------------------------------------------------------------------

describe("Agent Manager Webview — non-git sessionsLoaded fix", () => {
  const tsx = readAllTsx()

  /**
   * Regression: when isGitRepo is false, the Kilo server never sends a
   * "sessionsLoaded" message, so the skeleton was stuck forever.
   * The fix must set sessionsLoaded(true) when receiving a state message
   * with isGitRepo === false.
   */
  it("sets sessionsLoaded when agentManager.state arrives with isGitRepo false", () => {
    // Find the agentManager.state handler block
    const start = tsx.indexOf('"agentManager.state"')
    expect(start, "agentManager.state handler must exist").toBeGreaterThan(-1)
    const snippet = tsx.slice(start, start + 800)
    expect(snippet, "must call setSessionsLoaded in the non-git branch").toContain("setSessionsLoaded")
    expect(snippet, "must check isGitRepo === false before setting sessionsLoaded").toMatch(
      /isGitRepo.*false|false.*isGitRepo/,
    )
  })
})

// ---------------------------------------------------------------------------
// KiloProvider — pendingSessionRefresh race condition fix
// ---------------------------------------------------------------------------

describe("KiloProvider — pending session refresh on reconnect", () => {
  const provider = fs.readFileSync(KILO_PROVIDER_FILE, "utf-8")

  /**
   * Regression: when the Agent Manager opens its panel, initializeState()
   * calls refreshSessions() before the CLI server has started. Because
   * httpClient is null at that point, handleLoadSessions() used to bail
   * with an error message and never send "sessionsLoaded" to the webview.
   * The worktree would show up in the sidebar but display "No sessions open".
   *
   * The fix uses a pendingSessionRefresh flag: handleLoadSessions() sets
   * it when httpClient is unavailable, and both initializeConnection()
   * and the "connected" state handler flush the pending refresh.
   */
  it("handleLoadSessions sets pendingSessionRefresh when httpClient is null", () => {
    const start = provider.indexOf("private async handleLoadSessions()")
    expect(start, "handleLoadSessions must exist").toBeGreaterThan(-1)
    const snippet = provider.slice(start, start + 700)
    expect(snippet, "must read httpClient before loading sessions").toContain("const client = this.httpClient")
    expect(snippet, "must set pendingSessionRefresh when httpClient missing").toContain(
      "this.pendingSessionRefresh = true",
    )
    expect(snippet, "must avoid noisy errors while still connecting").toContain('this.connectionState !== "connecting"')
    expect(snippet, "must clear pendingSessionRefresh on successful entry").toContain(
      "this.pendingSessionRefresh = false",
    )
  })

  it("connected state handler flushes deferred session refresh", () => {
    // Find the onStateChange callback that handles "connected"
    const connectedIdx = provider.indexOf('state === "connected"')
    expect(connectedIdx, '"connected" state handler must exist').toBeGreaterThan(-1)
    const snippet = provider.slice(connectedIdx, connectedIdx + 800)
    expect(snippet, "must call flushPendingSessionRefresh from connected handler").toContain(
      'this.flushPendingSessionRefresh("sse-connected")',
    )
  })

  it("initializeConnection flushes deferred refresh for missed connected events", () => {
    const initIdx = provider.indexOf('this.syncWebviewState("initializeConnection")')
    expect(initIdx, "initializeConnection sync call must exist").toBeGreaterThan(-1)
    const snippet = provider.slice(initIdx, initIdx + 220)
    expect(snippet, "must flush deferred session refresh in initializeConnection").toContain(
      'this.flushPendingSessionRefresh("initializeConnection")',
    )
  })

  it("pendingSessionRefresh is declared as a class field", () => {
    expect(provider, "pendingSessionRefresh field must be declared").toMatch(
      /private\s+pendingSessionRefresh\s*=\s*false/,
    )
  })
})
