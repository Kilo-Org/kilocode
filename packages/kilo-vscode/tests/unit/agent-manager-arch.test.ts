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
const CSS_FILES = [
  path.join(ROOT, "webview-ui/agent-manager/agent-manager.css"),
  path.join(ROOT, "webview-ui/agent-manager/agent-manager-review.css"),
]
const TSX_FILES = [
  path.join(ROOT, "webview-ui/agent-manager/AgentManagerApp.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/NewWorktreeDialog.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/sortable-tab.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/DiffPanel.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/FullScreenDiffView.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/DiffEndMarker.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/FileTree.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/review-annotations.ts"),
  path.join(ROOT, "webview-ui/agent-manager/MultiModelSelector.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/ApplyDialog.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/BranchSelect.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/WorktreeItem.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/SectionHeader.tsx"),
  path.join(ROOT, "webview-ui/diff-virtual/DiffVirtualApp.tsx"),
]
const TSX_FILE = TSX_FILES[0]!
const PROVIDER_FILE = path.join(ROOT, "src/agent-manager/AgentManagerProvider.ts")
const DIFF_CONTROLLER_FILE = path.join(ROOT, "src/agent-manager/worktree-diff-controller.ts")
const IMPORTER_FILE = path.join(ROOT, "src/agent-manager/worktree-importer.ts")
const SETUP_SCRIPT_RUNNER_FILE = path.join(ROOT, "src/agent-manager/SetupScriptRunner.ts")

function readAllCss(): string {
  return CSS_FILES.map((f) => fs.readFileSync(f, "utf-8")).join("\n")
}

function readAllTsx(): string {
  return TSX_FILES.map((f) => fs.readFileSync(f, "utf-8")).join("\n")
}

describe("Agent Manager CSS Prefix", () => {
  it("all class selectors should use am- prefix", () => {
    const css = readAllCss()
    const matches = [...css.matchAll(/\.([a-z][a-z0-9-]*)/gi)]
    const names = [...new Set(matches.map((m) => m[1]))]

    // VS Code sets these body classes on webview elements — they are scoping
    // selectors for high contrast theme support, not agent-manager classes.
    const host = new Set(["vscode-high-contrast", "vscode-high-contrast-light"])
    const invalid = names.filter((n) => !n!.startsWith("am-") && !host.has(n!))

    expect(invalid, `Classes missing "am-" prefix: ${invalid.join(", ")}`).toEqual([])
  })

  it("all CSS custom properties should use am- prefix", () => {
    const css = readAllCss()
    const matches = [...css.matchAll(/--([a-z][a-z0-9-]*)\s*:/gi)]
    const names = [...new Set(matches.map((m) => m[1]))]

    // Allow kilo-ui design tokens, vscode theme variables, and third-party
    // library tokens (@pierre/diffs, kilo-ui sticky-accordion) used as fallbacks
    const allowed = ["am-", "vscode-", "surface-", "text-", "border-", "diffs-", "sticky-", "syntax-"]
    const invalid = names.filter((n) => !allowed.some((p) => n!.startsWith(p)))

    expect(invalid, `CSS properties missing allowed prefix: ${invalid.join(", ")}`).toEqual([])
  })

  it("all @keyframes should use am- prefix", () => {
    const css = readAllCss()
    const matches = [...css.matchAll(/@keyframes\s+([a-z][a-z0-9-]*)/gi)]
    const names = matches.map((m) => m[1])

    const invalid = names.filter((n) => !n!.startsWith("am-"))

    expect(invalid, `Keyframes missing "am-" prefix: ${invalid.join(", ")}`).toEqual([])
  })
})

describe("Agent Manager CSS/TSX Consistency", () => {
  it("all classes used in TSX should be defined in CSS", () => {
    const css = readAllCss()
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
    const css = readAllCss()
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

  function provider(): string {
    return fs.readFileSync(PROVIDER_FILE, "utf-8")
  }

  function diff(): string {
    return fs.readFileSync(DIFF_CONTROLLER_FILE, "utf-8")
  }

  function importer(): string {
    return fs.readFileSync(IMPORTER_FILE, "utf-8")
  }

  // -- onMessage dispatches all expected message types -----------------------

  it("provider routing handles all documented agentManager.* message types", () => {
    const text = provider()
    const expected = [
      "agentManager.createWorktree",
      "agentManager.deleteWorktree",
      "agentManager.promoteSession",
      "agentManager.addSessionToWorktree",
      "agentManager.forkSession",
      "agentManager.closeSession",
      "agentManager.persistSession",
      "agentManager.forgetSession",
      "agentManager.configureSetupScript",
      "agentManager.showTerminal",
      "agentManager.showLocalTerminal",
      "agentManager.showExistingLocalTerminal",
      "agentManager.requestRepoInfo",
      "agentManager.requestState",
      "agentManager.setTabOrder",
      "agentManager.setDefaultBaseBranch",
    ]
    for (const msg of expected) {
      expect(text, `provider routing should handle "${msg}"`).toContain(msg)
    }
  })

  it("session routing handles loadMessages for terminal switching", () => {
    const text = body("onSessionMessage")
    expect(text).toContain("loadMessages")
    expect(text).toContain("syncOnSessionSwitch")
  })

  it("session routing handles clearSession for SSE re-registration", () => {
    const text = body("onSessionMessage")
    expect(text).toContain("clearSession")
    expect(text).toContain("trackSession")
  })

  it("onMessage delegates to cohesive routing groups", () => {
    const text = body("onMessage")
    expect(text).toContain("onWorktreeMessage")
    expect(text).toContain("onSessionMessage")
    expect(text).toContain("onImportMessage")
    expect(text).toContain("onDiffMessage")
    expect(text).not.toContain("agentManager.requestState")
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
    const text = body("onRequestState")
    expect(text, "must call pushEmptyState when state is absent").toContain("pushEmptyState")
    expect(text, "must guard on this.state being falsy").toMatch(/!this\.state/)
  })

  it("requestState handler calls pushState when this.state is truthy", () => {
    const text = body("onRequestState")
    expect(text, "must call pushState for the normal path").toContain("this.pushState()")
  })

  it("worktree diff behavior lives in the cohesive diff controller", () => {
    const text = diff()
    const providerText = body("onDiffMessage")
    expect(text).toContain("class WorktreeDiffController")
    expect(text).toContain("buildWorktreePatch")
    expect(text).toContain("revertFile")
    expect(text).toContain("diffSummary")
    expect(text).toContain("shouldStopDiffPolling")
    expect(providerText).toContain("this.diffs")
  })

  it("worktree import behavior lives in the cohesive importer", () => {
    const text = importer()
    const providerText = body("onImportMessage")
    expect(text).toContain("class WorktreeImporter")
    expect(text).toContain("createFromPR")
    expect(text).toContain("listExternalWorktrees")
    expect(text).toContain("createWorktree")
    expect(providerText).toContain("this.importer")
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
  const utils = fs.readFileSync(path.join(ROOT, "src/kilo-provider-utils.ts"), "utf-8")

  /**
   * Regression: when the Agent Manager opens its panel, initializeState()
   * calls refreshSessions() before the CLI server has started. Because
   * httpClient is null at that point, handleLoadSessions() used to bail
   * with an error message and never send "sessionsLoaded" to the webview.
   * The worktree would show up in the sidebar but display "No sessions open".
   *
   * The fix uses a pendingSessionRefresh flag: loadSessions() (in
   * kilo-provider-utils) sets it when httpClient is unavailable, and
   * both initializeConnection() and the "connected" state handler flush
   * the pending refresh.
   */
  it("loadSessions sets pendingSessionRefresh when client is null", () => {
    const start = utils.indexOf("export async function loadSessions")
    expect(start, "loadSessions must exist in kilo-provider-utils").toBeGreaterThan(-1)
    const snippet = utils.slice(start, start + 700)
    expect(snippet, "must set pendingSessionRefresh when client missing").toContain("ctx.pendingSessionRefresh = true")
    expect(snippet, "must avoid noisy errors while still connecting").toContain('ctx.connectionState !== "connecting"')
    expect(snippet, "must clear pendingSessionRefresh on successful entry").toContain(
      "ctx.pendingSessionRefresh = false",
    )
  })

  it("handleLoadSessions delegates to loadSessionsUtil", () => {
    const start = provider.indexOf("private async handleLoadSessions()")
    expect(start, "handleLoadSessions must exist").toBeGreaterThan(-1)
    const snippet = provider.slice(start, start + 400)
    expect(snippet, "must call loadSessionsUtil").toContain("loadSessionsUtil")
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

// ---------------------------------------------------------------------------
// handleChangeDefaultBaseBranch — listener leak fix
// ---------------------------------------------------------------------------

describe("Agent Manager — dialog listener cleanup", () => {
  const tsx = fs.readFileSync(TSX_FILE, "utf-8")

  /**
   * Regression: handleChangeDefaultBaseBranch subscribes to vscode.onMessage
   * for branch data. Previously unsub() was only called inside selectBranch()
   * and the Escape keydown handler. If the dialog closed via backdrop click or
   * external dialog.close(), the listener leaked and stacked on every reopen.
   *
   * The fix ties unsub() to Solid's onCleanup inside the dialog.show() render
   * function so it always disposes regardless of how the dialog closes.
   */
  it("handleChangeDefaultBaseBranch uses onCleanup(unsub) inside dialog.show", () => {
    const fnStart = tsx.indexOf("const handleChangeDefaultBaseBranch")
    expect(fnStart, "handleChangeDefaultBaseBranch must exist").toBeGreaterThan(-1)

    // Grab the function body (enough to cover the dialog.show callback)
    const snippet = tsx.slice(fnStart, fnStart + 2000)

    // The dialog.show callback must register onCleanup(unsub)
    const showIdx = snippet.indexOf("dialog.show(")
    expect(showIdx, "dialog.show() call must exist").toBeGreaterThan(-1)
    const afterShow = snippet.slice(showIdx)
    expect(afterShow, "onCleanup(unsub) must be inside dialog.show callback").toContain("onCleanup(unsub)")
  })

  it("selectBranch does not manually call unsub (handled by onCleanup)", () => {
    const fnStart = tsx.indexOf("const handleChangeDefaultBaseBranch")
    const snippet = tsx.slice(fnStart, fnStart + 2000)

    // Find the selectBranch function body
    const selStart = snippet.indexOf("const selectBranch")
    expect(selStart, "selectBranch must exist").toBeGreaterThan(-1)
    const selEnd = snippet.indexOf("}", selStart + 50)
    const selBody = snippet.slice(selStart, selEnd + 1)

    expect(selBody, "selectBranch should not call unsub() directly").not.toContain("unsub()")
  })
})

describe("SetupScriptRunner — task execution model", () => {
  const runner = fs.readFileSync(SETUP_SCRIPT_RUNNER_FILE, "utf-8")
  const taskAdapter = fs.readFileSync(path.join(ROOT, "src/agent-manager/task-runner.ts"), "utf-8")

  it("runner is vscode-free and delegates execution via RunTask callback", () => {
    expect(runner).not.toContain("vscode")
    expect(runner).toContain("RunTask")
    expect(runner).toContain("buildSetupTaskCommand")
  })

  it("runner still provides WORKTREE_PATH and REPO_PATH env vars", () => {
    expect(runner).toContain("WORKTREE_PATH")
    expect(runner).toContain("REPO_PATH")
  })

  it("task-runner adapter hosts the vscode task execution", () => {
    expect(taskAdapter).toContain("vscode.tasks.executeTask")
    expect(taskAdapter).toContain("onDidEndTaskProcess")
    expect(taskAdapter).toContain("new vscode.ProcessExecution")
  })

  it("does not use manual terminal command injection", () => {
    expect(runner).not.toContain("createTerminal")
    expect(runner).not.toContain("sendText")
  })
})

// ---------------------------------------------------------------------------
// VS Code import boundary — layering enforcement
//
// The agent-manager is being decoupled from VS Code so it can eventually run
// outside the extension host. These tests enforce the layering:
//
//   1. Only files on the VSCODE_ALLOWED list may import "vscode".
//   2. Each allowed file has a maxLines cap — shrink it as logic is extracted.
//
// To improve the architecture:
//   - Extract business logic from allowed files into vscode-free modules.
//   - Lower maxLines once the extraction lands.
//   - Remove entries from VSCODE_ALLOWED once they no longer need vscode.
// ---------------------------------------------------------------------------

const AGENT_MANAGER_DIR = path.join(ROOT, "src/agent-manager")

/**
 * Exception list: files currently allowed to import `vscode`.
 *
 * Each entry has a maxLines cap. The goal is to shrink these over time and
 * eventually remove entries as logic moves into vscode-free modules.
 *
 * When you extract code out of one of these files, lower its maxLines to
 * the new line count rounded up to the nearest 50.
 *
 * DO NOT raise maxLines to accommodate new code. If adding a feature would
 * exceed the cap, extract logic into a vscode-free helper module and have
 * the provider call it. Only raise the cap as a last resort when the code
 * is structurally impossible to extract (e.g. deep vscode API interleaving)
 * — and document the reason in the entry's `note` field.
 */
const VSCODE_ALLOWED: Record<string, { note: string }> = {
  // VS Code adapter implementing the Host interface for the Agent Manager
  "vscode-host.ts": {
    note: "vscode adapter implementing Host interface",
  },
  // Thin adapter: wraps vscode.window terminal APIs behind TerminalHost interface
  "terminal-host.ts": {
    note: "vscode adapter for SessionTerminalManager",
  },
  // Thin adapter: wraps vscode.tasks API behind RunTask callback
  "task-runner.ts": {
    note: "vscode adapter for SetupScriptRunner",
  },
}

/**
 * File size caps — prevent large files from growing unchecked.
 *
 * When you extract code out of one of these files, lower its maxLines to
 * the new line count rounded up to the nearest 50.
 *
 * DO NOT raise maxLines to accommodate new code. If adding a feature would
 * exceed the cap, extract logic into a vscode-free helper module and have
 * the provider call it. Only raise the cap as a last resort when the code
 * is structurally impossible to extract (e.g. deep vscode API interleaving)
 * — and document the reason in the entry's `note` field.
 */
const MAX_LINES: Record<string, { maxLines: number; note: string }> = {
  "AgentManagerProvider.ts": {
    maxLines: 2000,
    note: "diff and import workflows are extracted into cohesive domain services; extract more orchestration next",
  },
}

function importsVscode(content: string): boolean {
  return /(?:from|require\()\s*["']vscode["']/.test(content)
}

function agentManagerSourceFiles(): string[] {
  return fs
    .readdirSync(AGENT_MANAGER_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".spec.ts"))
}

describe("Agent Manager — VS Code import boundary", () => {
  it("only allowlisted files may import vscode", () => {
    const violations: string[] = []
    for (const file of agentManagerSourceFiles()) {
      if (file in VSCODE_ALLOWED) continue
      const content = fs.readFileSync(path.join(AGENT_MANAGER_DIR, file), "utf-8")
      if (importsVscode(content)) violations.push(file)
    }
    expect(
      violations,
      `These files import "vscode" but are not on the exception list.\n` +
        `Either extract the vscode dependency or add them to VSCODE_ALLOWED:\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    ).toEqual([])
  })

  it("capped files stay within their maxLines limit", () => {
    const overweight: string[] = []
    for (const [file, { maxLines }] of Object.entries(MAX_LINES)) {
      const filepath = path.join(AGENT_MANAGER_DIR, file)
      if (!fs.existsSync(filepath)) continue
      const lines = fs.readFileSync(filepath, "utf-8").split("\n").length
      if (lines > maxLines) overweight.push(`${file}: ${lines} lines (cap: ${maxLines})`)
    }
    expect(
      overweight,
      `File too large — needs better modularization.\n\n` +
        overweight.map((o) => `  ${o}`).join("\n") +
        `\n\n` +
        `Do NOT raise maxLines. Instead, extract logic into a vscode-free\n` +
        `helper module and call it from the provider. See fork-session.ts\n` +
        `for an example of this pattern.`,
    ).toEqual([])
  })

  it("every allowlisted file actually exists", () => {
    const stale = Object.keys(VSCODE_ALLOWED).filter((f) => !fs.existsSync(path.join(AGENT_MANAGER_DIR, f)))
    expect(
      stale,
      `These files are in VSCODE_ALLOWED but no longer exist — remove them:\n` +
        stale.map((s) => `  - ${s}`).join("\n"),
    ).toEqual([])
  })

  it("every allowlisted file actually imports vscode", () => {
    const unnecessary: string[] = []
    for (const file of Object.keys(VSCODE_ALLOWED)) {
      const filepath = path.join(AGENT_MANAGER_DIR, file)
      if (!fs.existsSync(filepath)) continue
      if (!importsVscode(fs.readFileSync(filepath, "utf-8"))) unnecessary.push(file)
    }
    expect(
      unnecessary,
      `These files no longer import "vscode" — remove them from VSCODE_ALLOWED:\n` +
        unnecessary.map((u) => `  - ${u}`).join("\n"),
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Provider chain parity — sidebar App.tsx vs AgentManagerApp.tsx
//
// The agent manager reuses ChatView (and therefore MessageList, etc.) from the
// sidebar. Any context provider that ChatView's tree may call useXxx() on must
// also be present in the agent manager's provider chain. A missing provider
// crashes the entire SolidJS component tree silently.
//
// Regression: PR #7473 moved KiloNotifications into MessageList. It calls
// useNotifications(), but NotificationsProvider was only in App.tsx — the agent
// manager rendered a blank screen.
// ---------------------------------------------------------------------------

const APP_FILE = path.join(ROOT, "webview-ui/src/App.tsx")
const AGENT_MANAGER_APP_FILE = path.join(ROOT, "webview-ui/agent-manager/AgentManagerApp.tsx")

describe("Agent Manager — provider chain parity with sidebar", () => {
  /**
   * Extract provider component names used as JSX elements in a file.
   * Matches `<FooProvider` and `<FooProvider>` patterns, returning the names.
   */
  function extractProviders(content: string): string[] {
    const matches = [...content.matchAll(/<(\w+Provider)\b/g)]
    return [...new Set(matches.map((m) => m[1]!))]
  }

  /**
   * Providers that the agent manager intentionally omits because it does not
   * use the components that depend on them. If a shared component (ChatView,
   * MessageList, etc.) starts using one of these, the test will fail and
   * force the developer to add the provider to AgentManagerApp.tsx.
   */
  const KNOWN_EXCLUSIONS: string[] = [
    // These are wrapped by LanguageBridge and DataBridge respectively,
    // which the agent manager already includes in its provider chain.
    "LanguageProvider",
    "DataProvider",
  ]

  it("agent manager includes all context providers from sidebar App.tsx", () => {
    const sidebar = fs.readFileSync(APP_FILE, "utf-8")
    const agent = fs.readFileSync(AGENT_MANAGER_APP_FILE, "utf-8")

    const sidebarProviders = extractProviders(sidebar)
    const agentProviders = extractProviders(agent)
    const agentSet = new Set(agentProviders)
    const excluded = new Set(KNOWN_EXCLUSIONS)

    const missing = sidebarProviders.filter((p) => !agentSet.has(p) && !excluded.has(p))

    expect(
      missing,
      `These providers are in App.tsx but missing from AgentManagerApp.tsx.\n` +
        `The agent manager reuses ChatView — any provider that ChatView's component\n` +
        `tree depends on must be present in both provider chains.\n\n` +
        `Missing providers:\n` +
        missing.map((p) => `  - ${p}`).join("\n") +
        `\n\nFix: add the missing <${missing[0]}> to AgentManagerApp.tsx's provider chain,\n` +
        `or add it to KNOWN_EXCLUSIONS with a justification if it's truly unused.`,
    ).toEqual([])
  })
})
