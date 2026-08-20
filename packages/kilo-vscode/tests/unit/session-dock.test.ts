/**
 * Session dock layout contract.
 *
 * The row between the transcript and the composer used to be two things at
 * once: the working indicator lived inside the scrollable transcript (with a
 * 10px placeholder left behind when it disappeared) and the session actions
 * were a separate block in the composer column. Both changed height when a turn
 * ended, the two offsets did not cancel out, and the conversation text jumped a
 * few pixels every time.
 *
 * The invariant now: one dock, one decision point, one fixed height.
 */

import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { showsWorking } from "../../webview-ui/src/components/shared/working-indicator-utils"

const ROOT = path.resolve(import.meta.dir, "../..")

function read(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), "utf-8")
}

describe("showsWorking", () => {
  it("shows the indicator for active backend statuses", () => {
    expect(showsWorking("busy", false, false)).toBe(true)
    expect(showsWorking("retry", false, false)).toBe(true)
    expect(showsWorking("offline", false, false)).toBe(true)
  })

  it("shows the indicator for a submission before backend status arrives", () => {
    expect(showsWorking("idle", true, false)).toBe(true)
  })

  it("yields the row to the session actions once idle", () => {
    expect(showsWorking("idle", false, false)).toBe(false)
  })

  it("stays hidden while another surface owns the interaction", () => {
    expect(showsWorking("busy", false, true)).toBe(false)
    expect(showsWorking("idle", true, true)).toBe(false)
  })
})

describe("session dock layout", () => {
  it("stacks both states in one grid cell so the row measures the taller one", () => {
    const css = read("webview-ui/src/styles/chat-layout.css")
    const dock = css.match(/\.session-dock \{([\s\S]*?)\}/)
    const state = css.match(/\.session-dock-state \{([\s\S]*?)\}/)
    expect(dock).not.toBeNull()
    expect(state).not.toBeNull()
    expect(dock![1]).toContain("display: grid")
    expect(state![1]).toContain("grid-area: 1 / 1")
    // A hard-coded height clipped the actions row once it wrapped to a second
    // line in a narrow sidebar, so the row must size itself.
    expect(dock![1]).not.toMatch(/^\s*height:/m)
    expect(dock![1]).not.toContain("overflow: hidden")
  })

  it("hides the inactive state instead of unmounting it", () => {
    const css = read("webview-ui/src/styles/chat-layout.css")
    const hidden = css.match(/\.session-dock-state:not\(\[data-active\]\) \{([\s\S]*?)\}/)
    expect(hidden).not.toBeNull()
    // display:none would stop reserving the height and bring the shift back.
    expect(hidden![1]).toContain("visibility: hidden")
    expect(hidden![1]).toContain("pointer-events: none")
    expect(hidden![1]).not.toContain("display: none")
  })

  it("keeps the reserved actions row independent of the turn lifecycle", () => {
    const view = read("webview-ui/src/components/chat/ChatView.tsx")
    const fork = view.match(/const canFork = \(hasChat: boolean\) =>([^\n]*)/)
    expect(fork).not.toBeNull()
    // A button that came and went with the turn would resize the hidden row.
    expect(fork![1]).not.toContain('session.status() === "idle"')
    expect(view).toContain("session.messages().length > 0 || session.submitting()")
  })

  it("drops the placeholder that used to offset the session actions", () => {
    const css = read("webview-ui/src/styles/chat-layout.css")
    expect(css).not.toContain("working-indicator-slot")
    expect(read("webview-ui/src/components/shared/WorkingIndicator.tsx")).not.toContain("working-indicator-slot")
  })

  it("keeps the composer column as the only owner of the row", () => {
    // A second copy inside the scrollable transcript would resize the scroll
    // content on every turn boundary again.
    expect(read("webview-ui/src/components/chat/MessageList.tsx")).not.toContain("WorkingIndicator")
    expect(read("webview-ui/src/components/chat/ChatView.tsx")).toContain("<SessionDock")
  })

  it("routes both states through the dock so neither can claim the row alone", () => {
    const dock = read("webview-ui/src/components/chat/SessionDock.tsx")
    expect(dock).toContain("showsWorking(session.status(), session.submitting()")
    expect(dock).toContain('data-active={working() ? "" : undefined}')
    expect(dock).toContain('data-active={actions() ? "" : undefined}')
    // The indicator must not re-decide its own visibility.
    expect(read("webview-ui/src/components/shared/WorkingIndicator.tsx")).not.toContain("session.submitting() ||")
  })
})
