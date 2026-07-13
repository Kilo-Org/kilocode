/**
 * Source contract test for selectSession's connection handling.
 *
 * Static analysis — reads session.tsx and verifies that selectSession updates
 * the current session id BEFORE (and independently of) the backend connection
 * check, and only defers the message fetch when offline.
 *
 * Regression guard: previously selectSession bailed out entirely when
 * `server.isConnected()` was false. In Agent Manager the side diff is resolved
 * from the worktree selection independently of currentSessionID, so a switch
 * during a transient disconnect moved the diff but left the chat frozen on the
 * previous session ("switching only changes the sidebar diff"). The chat must
 * always follow the selection; only the network fetch may wait for reconnect.
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const SESSION_FILE = path.join(ROOT, "webview-ui/src/context/session.tsx")

const source = fs.readFileSync(SESSION_FILE, "utf-8")

describe("selectSession keeps the chat in sync with the selection while offline", () => {
  const start = source.indexOf("function selectSession(")
  const cloudGuard = source.indexOf('id.startsWith("cloud:")', start)
  const setCurrent = source.indexOf("setCurrentSessionID(id)", start)
  const offlineDefer = source.indexOf("if (!server.isConnected()) {", start)

  it("selectSession exists", () => {
    expect(start).toBeGreaterThan(-1)
  })

  it("returns early for cloud preview ids before touching the current session", () => {
    expect(cloudGuard).toBeGreaterThan(start)
    expect(cloudGuard).toBeLessThan(setCurrent)
  })

  it("sets currentSessionID before checking the connection (chat follows selection offline)", () => {
    expect(setCurrent).toBeGreaterThan(-1)
    expect(offlineDefer).toBeGreaterThan(-1)
    // The whole point of the fix: the local selection update must precede the
    // connection guard, so a disconnected switch no longer freezes the chat.
    expect(setCurrent).toBeLessThan(offlineDefer)
  })

  it("defers the fetch for any session while offline, including cached ones", () => {
    const body = source.slice(start, source.indexOf("\n  function loadFocusedMessages("))
    // Queue a replay unconditionally. The earlier `deferredFetch = ready ? undefined : id`
    // form skipped cached sessions, so a reconnect never re-sent the focus load that
    // re-focuses the backend (focusSession/contextSessionID/SSE tracking/reconcile).
    expect(body).toContain("deferredFetch = id")
    expect(body).not.toMatch(/deferredFetch\s*=\s*ready\s*\?/)
  })
})

describe("a deferred fetch is replayed on reconnect", () => {
  it("watches the connection and replays the deferred session load", () => {
    expect(source).toContain("on(server.isConnected")
    const effect = source.slice(source.indexOf("on(server.isConnected"))
    expect(effect).toContain("deferredFetch")
    // Replays with the focus/replace choice so cached sessions still re-focus the backend.
    expect(effect).toMatch(/loadFocusedMessages\(\s*id,\s*loaded\(\)\.has\(id\)\s*\)/)
  })

  it("the focused load helper sends focus for cached sessions and replace otherwise", () => {
    const helper = source.slice(source.indexOf("function loadFocusedMessages("))
    expect(helper).toMatch(/mode: "focus"/)
    expect(helper).toMatch(/mode: "replace"/)
  })
})
