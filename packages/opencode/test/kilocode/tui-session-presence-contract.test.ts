/**
 * Contract test for the TUI presence snapshot in kilocode/cli/cmd/tui/app.tsx.
 *
 * `useSessionEffects` must run inside a SolidJS owner with the @opentui/solid
 * renderer context, so mounting it in a unit test would require mocking the TUI
 * framework internals. These source-contract assertions pin the load-bearing
 * presence behaviour instead: the snapshot payload shape (route session as both
 * attached and visible), focus/blur toggling only `viewer.active`, the 60s
 * check-in, the backend-reconnect resend, and the cleanup path (listeners and
 * timer removed, reconnect listener unsubscribed, final empty inactive snapshot).
 */

import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const APP_FILE = path.resolve(import.meta.dir, "../../src/kilocode/cli/cmd/tui/app.tsx")

/** The useSessionEffects function body, so assertions don't match unrelated code. */
function effects() {
  const content = fs.readFileSync(APP_FILE, "utf-8")
  const start = content.indexOf("export function useSessionEffects")
  const end = content.indexOf("export function getTerminalTitle")
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return content.slice(start, end)
}

/** The onCleanup block of useSessionEffects (it is the last statement of the hook). */
function cleanup() {
  const body = effects()
  const start = body.indexOf("onCleanup(() => {")
  expect(start).toBeGreaterThan(-1)
  return body.slice(start)
}

/** Collapse whitespace so multi-line expressions match regardless of formatting. */
function flat(source: string) {
  return source.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").replace(/,\)/g, ")")
}

describe("TUI session presence contract", () => {
  test("snapshot sends the route session as both attached and visible", () => {
    const body = effects()
    expect(body).toContain('deps.route.data.type === "session" ? deps.route.data.sessionID : undefined')
    expect(body).toContain("const ids = id ? [id] : []")
    expect(flat(body)).toContain(
      "deps.sdk.client.session.viewed({ viewer: { id: viewerId, active }, attached: ids, visible: ids }).catch(() => {})",
    )
  })

  test("focus sets active=true, blur sets active=false, both resend the snapshot", () => {
    const body = flat(effects())
    expect(body).toContain("const onFocus = () => { active = true send() }")
    expect(body).toContain("const onBlur = () => { active = false send() }")
    expect(body).toContain('renderer.on("focus", onFocus)')
    expect(body).toContain('renderer.on("blur", onBlur)')
  })

  test("60s check-in interval exists and is cleared on cleanup", () => {
    expect(effects()).toContain("const timer = setInterval(send, 60_000)")
    expect(cleanup()).toContain("clearInterval(timer)")
  })

  test("server.connected resends the snapshot and is unsubscribed on cleanup", () => {
    expect(flat(effects())).toContain(
      'const offConnected = deps.sdk.event.on("event", (event) => { if (event.payload.type === "server.connected") send() })',
    )
    expect(cleanup()).toContain("offConnected()")
  })

  test("cleanup removes focus/blur listeners and sends a final inactive empty snapshot", () => {
    const tail = cleanup()
    expect(tail).toContain('renderer.off("focus", onFocus)')
    expect(tail).toContain('renderer.off("blur", onBlur)')
    expect(flat(tail)).toContain(".viewed({ viewer: { id: viewerId, active: false }, attached: [], visible: [] })")
  })
})
