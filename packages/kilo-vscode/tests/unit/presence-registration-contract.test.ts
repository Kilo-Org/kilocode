/**
 * Source contract tests for session-presence registration.
 *
 * Static analysis — reads KiloProvider.ts, AgentManagerProvider.ts,
 * vscode-host.ts, and connection-service.ts and verifies the locked
 * viewed/presence behavior from the presence plan:
 *
 * - Editor panels register visible keyed on `panel.visible` and the
 *   synchronous `contextSessionID`; attachment persists while hidden.
 * - Embedded Agent Manager providers skip generic viewed registration
 *   (`disableViewedRegistration`) so sessions are not double-reported.
 * - The connection service resends the full snapshot on backend reconnect.
 * - Agent Manager visible presence is routed through
 *   AgentManagerVisiblePresence so cleanup cannot leave a stale displayed id.
 *
 * Protects against accidental removal during Kilo development.
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const KILOPROVIDER_FILE = path.join(ROOT, "src/KiloProvider.ts")
const AGENT_MANAGER_PROVIDER_FILE = path.join(ROOT, "src/agent-manager/AgentManagerProvider.ts")
const VSCODE_HOST_FILE = path.join(ROOT, "src/agent-manager/vscode-host.ts")
const CONNECTION_SERVICE_FILE = path.join(ROOT, "src/services/cli-backend/connection-service.ts")

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8")
}

describe("KiloProvider editor-panel visible registration contract", () => {
  const source = readFile(KILOPROVIDER_FILE)
  // The bindPanel callback installed in resolveWebviewPanel.
  const match = source.match(
    /this\.viewStateDisposable = this\.visibleTaskStreams\.bindPanel\(panel, \(\) => \{([\s\S]*?)\n {4}\}\)/,
  )

  it("binds a view-state callback on the panel", () => {
    expect(match).not.toBeNull()
  })

  it("registers visible keyed on panel.visible and the synchronous contextSessionID", () => {
    // `panel.active` would drop visible-but-inactive split editors, and
    // `this.currentSession?.id` is populated asynchronously — rapid A→B
    // navigation must report B without awaiting B's metadata fetch.
    const body = match![1]
    expect(body).toContain("this.contextSessionID")
    expect(body).toContain("panel.visible")
    expect(body).toContain("this.connectionService.registerVisible(this.instanceId,")
    expect(body).not.toContain("panel.active")
    expect(body).not.toContain("this.currentSession")
  })

  it("does not clear attachment when the panel is hidden", () => {
    // Hidden editor tabs stay reachable for remote control: the panel
    // view-state callback must never touch the attached registration
    // (directly or via focusSession) — attachment is cleared only by the
    // dispose/clear/delete paths.
    const body = match![1]
    expect(body).toContain("this.streams.focus(panel.visible ? id : undefined)")
    expect(body).not.toContain("registerAttached")
    expect(body).not.toContain("focusSession")
  })
})

describe("KiloProvider disableViewedRegistration contract", () => {
  const kiloProvider = readFile(KILOPROVIDER_FILE)
  const vscodeHost = readFile(VSCODE_HOST_FILE)

  it("registerPresence skips viewed registration when the option is set", () => {
    const match = kiloProvider.match(/private registerPresence\(\): void \{([\s\S]*?)\n {2}\}/)
    expect(match).not.toBeNull()
    const body = match![1]
    const guard = body.indexOf("if (this.opts.disableViewedRegistration) return")
    const visible = body.indexOf("this.connectionService.registerVisible(this.instanceId,")
    const attached = body.indexOf("this.connectionService.registerAttached(this.instanceId,")
    expect(guard).toBeGreaterThanOrEqual(0)
    expect(visible).toBeGreaterThan(guard)
    expect(attached).toBeGreaterThan(guard)
  })

  it("focusSession and trackOpenSessions report through registerPresence", () => {
    // Both the focused session (visible) and the open local tabs (attached)
    // funnel into one snapshot so neither write can clobber the other.
    const focus = kiloProvider.match(/private focusSession\(id\?: string\): void \{([\s\S]*?)\n {2}\}/)
    expect(focus).not.toBeNull()
    expect(focus![1]).toContain("this.registerPresence()")
    const track = kiloProvider.match(/private trackOpenSessions\(ids: string\[\]\): void \{([\s\S]*?)\n {2}\}/)
    expect(track).not.toBeNull()
    expect(track![1]).toContain("this.registerPresence()")
  })

  it("registerPresence attaches the open local tabs plus the focused session", () => {
    const match = kiloProvider.match(/private registerPresence\(\): void \{([\s\S]*?)\n {2}\}/)
    expect(match).not.toBeNull()
    const body = match![1]
    expect(body).toContain("const attached = new Set(this.openSessionIds)")
    expect(body).toContain("if (focused) attached.add(focused)")
  })

  it("the editor-panel view-state callback honors the same option", () => {
    const match = kiloProvider.match(
      /this\.viewStateDisposable = this\.visibleTaskStreams\.bindPanel\(panel, \(\) => \{([\s\S]*?)\n {4}\}\)/,
    )
    expect(match).not.toBeNull()
    const guard = match![1].indexOf("if (this.opts.disableViewedRegistration) return")
    const visible = match![1].indexOf("registerVisible")
    expect(guard).toBeGreaterThanOrEqual(0)
    expect(visible).toBeGreaterThan(guard)
  })

  it("embedded Agent Manager providers disable generic viewed registration", () => {
    // Each Agent Manager panel hosts a full KiloProvider; the "agent-manager"
    // keys own presence there, so the embedded provider must not
    // double-register under its own instanceId.
    expect(vscodeHost).toContain("disableViewedRegistration: true")
  })
})

describe("KiloConnectionService connection snapshot contract", () => {
  const source = readFile(CONNECTION_SERVICE_FILE)

  it("sends the accumulated snapshot on initial connection and reconnect", () => {
    const start = source.indexOf('if (sseState === "connected")')
    const end = source.indexOf('if (!didConnect && sseState === "disconnected")', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const body = source.slice(start, end)
    expect(body).toContain("this.flushViewed()")
    expect(body).not.toContain("if (isReconnect)")
  })
})

describe("AgentManagerProvider visible-presence contract", () => {
  const source = readFile(AGENT_MANAGER_PROVIDER_FILE)

  it("routes all agent-manager visible registration through AgentManagerVisiblePresence", () => {
    // Exactly one direct registerVisible("agent-manager", ...) call site — the
    // presence callback. Cleanup paths that bypassed it (registering [] without
    // clearing the displayed id) let a stale id re-register on the next flush.
    const sites = source.match(/registerVisible\("agent-manager"/g) ?? []
    expect(sites).toHaveLength(1)
    expect(source).toMatch(
      /new AgentManagerVisiblePresence\(\s*\(ids\) => this\.connectionService\.registerVisible\("agent-manager", ids\)/,
    )
  })

  it("async shutdown clears both the visible and attached registrations", () => {
    // clear() resets the displayed id and empties the attached set, so a
    // stale id cannot re-register on a later flush.
    const match = source.match(/private async disposeAsync\(\): Promise<void> \{([\s\S]*?)\n {2}\}/)
    expect(match).not.toBeNull()
    expect(match![1]).toContain("this.visiblePresence.clear()")
  })

  it("routes the webview presence messages to visiblePresence.handle", () => {
    // The webview reports the open tab set (→ attached) and the actually
    // displayed real session id (null for terminal/review/pending/empty
    // tabs, → visible); both flow through the presence helper.
    expect(source).toMatch(
      /if \(m\.type === "agentManager\.openSessions" \|\| m\.type === "agentManager\.visibleSession"\) \{\s*this\.visiblePresence\.handle\(m\)/,
    )
  })

  it("does not let background message loads override webview visibility", () => {
    const match = source.match(/if \(m\.type === "loadMessages"\) \{([\s\S]*?)\n {4}\}/)
    expect(match).not.toBeNull()
    expect(match![1]).not.toContain("visiblePresence.setDisplayed")
  })

  it("recomputes visible presence when panel visibility changes", () => {
    // A hidden Agent Manager panel must drop its session from visible (while
    // keeping it attached); reappearing must re-register the retained id.
    const match = source.match(/ctx\.onDidChangeVisibility\(\(visible\) => \{([\s\S]*?)\n {4}\}\)/)
    expect(match).not.toBeNull()
    expect(match![1]).toContain("this.visiblePresence.flush()")
  })
})
