/**
 * Source contract test for the "jump to latest" scroll-to-bottom request
 * that a notification-driven session open attaches to `selectSession`.
 *
 * Static analysis — full Solid.js signal/effect behavior isn't exercised by a
 * component harness in this package's unit tests, so this verifies the wiring
 * by inspecting the source: `selectSession` records the intent before the
 * per-session scroll-position restore logic in MessageList can run, and
 * `consumeScrollBottom` is one-shot so it doesn't affect later switches back
 * to the same session.
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const SESSION_FILE = path.join(ROOT, "webview-ui/src/context/session.tsx")
const TABS_FILE = path.join(ROOT, "webview-ui/src/context/local-tabs.tsx")
const APP_FILE = path.join(ROOT, "webview-ui/src/App.tsx")
const MESSAGE_LIST_FILE = path.join(ROOT, "webview-ui/src/components/chat/MessageList.tsx")

const session = fs.readFileSync(SESSION_FILE, "utf-8")
const tabs = fs.readFileSync(TABS_FILE, "utf-8")
const app = fs.readFileSync(APP_FILE, "utf-8")
const messageList = fs.readFileSync(MESSAGE_LIST_FILE, "utf-8")

function extractFunctionBody(source: string, name: string): string {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  if (start === -1) return ""
  const rest = source.slice(start + marker.length)
  const next = rest.search(/\n  function /)
  return next === -1 ? rest : rest.slice(0, next)
}

describe("selectSession records a pending scroll-to-bottom request", () => {
  it("sets scrollBottomID before touching currentSessionID", () => {
    const body = extractFunctionBody(session, "selectSession")
    const setScroll = body.indexOf("setScrollBottomID(")
    const setCurrent = body.indexOf("setCurrentSessionID(id)")
    expect(setScroll).toBeGreaterThan(-1)
    expect(setCurrent).toBeGreaterThan(setScroll)
  })

  it("only records the request when explicitly asked", () => {
    const body = extractFunctionBody(session, "selectSession")
    expect(body).toMatch(/setScrollBottomID\(options\.scrollToBottom \? id : undefined\)/)
  })

  it("clears an unconsumed request on a later plain selection", () => {
    // Guards a leak: MessageList returns early while loading(), so a request
    // that was never consumed would otherwise fire on a future switch back to
    // that session and override its saved scroll position.
    const body = extractFunctionBody(session, "selectSession")
    expect(body).not.toMatch(/if \(options\.scrollToBottom\) setScrollBottomID/)
    expect(body).toContain(": undefined)")
  })
})

describe("consumeScrollBottom is a one-shot check", () => {
  const body = extractFunctionBody(session, "consumeScrollBottom")

  it("returns false for a different or already-consumed id", () => {
    expect(body).toMatch(/if \(scrollBottomID\(\) !== id\) return false/)
  })

  it("clears the pending id once consumed", () => {
    expect(body).toContain("setScrollBottomID(undefined)")
  })

  it("is exposed on the session context", () => {
    expect(session).toContain("consumeScrollBottom,")
    expect(session).toContain("scrollBottomID,")
  })
})

describe("local tabs propagate the scroll-to-bottom option", () => {
  it("open() forwards options to focus(), which forwards to selectSession", () => {
    // local-tabs.tsx declares these as `const name = (...) => {}`, not
    // `function name(...)`, so this checks the arrow-function bodies directly
    // rather than reusing the `function `-based extractFunctionBody helper.
    const openStart = tabs.indexOf("const open = (id: string")
    const focusStart = tabs.indexOf("const focus = (id: string | undefined")
    expect(openStart).toBeGreaterThan(-1)
    expect(focusStart).toBeGreaterThan(-1)
    const openBody = tabs.slice(openStart, tabs.indexOf("\n  }", openStart))
    const focusBody = tabs.slice(focusStart, tabs.indexOf("\n  }", focusStart))
    expect(openBody).toContain("focus(id, options)")
    expect(focusBody).toContain("session.selectSession(id, options)")
  })
})

describe("the openSession webview message requests scroll-to-bottom", () => {
  it("passes scrollToBottom: true for both the tabbed and sidebar paths", () => {
    const openHandler = app.slice(app.indexOf('message.type !== "openSession"'))
    expect(openHandler).toMatch(/tabs\.open\(message\.sessionID, \{ scrollToBottom: true \}\)/)
    expect(openHandler).toMatch(/session\.selectSession\(message\.sessionID, \{ scrollToBottom: true \}\)/)
  })
})

describe("the Storybook session mock satisfies what MessageList reads", () => {
  // Stories render MessageList against a hand-written mock cast to `any`, so
  // TypeScript cannot catch a missing member. `scrollBottomID` in particular has
  // to be an accessor, since it is passed to `on(...)`: leaving it out throws on
  // mount and takes down every chat story in the visual regression suite.
  const providers = fs.readFileSync(path.join(ROOT, "webview-ui/src/stories/StoryProviders.tsx"), "utf-8")

  it("provides scrollBottomID as an accessor and consumeScrollBottom", () => {
    expect(providers).toMatch(/scrollBottomID: \(\) =>/)
    expect(providers).toMatch(/consumeScrollBottom: \(\) =>/)
  })
})

describe("MessageList arms a restore pass for the already-selected session", () => {
  it("watches scrollBottomID, not just currentSessionID", () => {
    // Clicking Show on the session that is already current does not change
    // currentSessionID, so the `on(session.currentSessionID)` effect never
    // re-runs and the request would otherwise never be consumed.
    expect(messageList).toContain("on(session.scrollBottomID")
    const start = messageList.indexOf("on(session.scrollBottomID")
    const block = messageList.slice(start, start + 200)
    expect(block).toContain("setPendingRestore(id)")
    expect(block).toContain("session.currentSessionID()")
  })
})

describe("MessageList consumes the pending request ahead of scroll-position restore", () => {
  it("checks consumeScrollBottom before reading the saved scroll state", () => {
    const consume = messageList.indexOf("session.consumeScrollBottom(id)")
    const restore = messageList.indexOf("const state = getScroll(id)")
    expect(consume).toBeGreaterThan(-1)
    expect(restore).toBeGreaterThan(consume)
  })

  it("forces scroll to bottom and does not fall through to anchor restore", () => {
    const start = messageList.indexOf("session.consumeScrollBottom(id)")
    const block = messageList.slice(start, messageList.indexOf("const state = getScroll(id)"))
    expect(block).toContain("autoScroll.forceScrollToBottom()")
    expect(block).toContain("return")
  })
})
