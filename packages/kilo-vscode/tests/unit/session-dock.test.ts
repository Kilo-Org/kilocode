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
    const state = css.match(/^\.session-dock-state \{([\s\S]*?)\}/m)
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

  it("keeps Goal inside the shared session actions", () => {
    const view = read("webview-ui/src/components/chat/ChatView.tsx")
    expect(view).toContain("hasActions={() => !props.readonly && (hasActions(hasMessages()) || !!goal())}")
    expect(view).toContain("actions={(control) => renderActions(hasMessages(), control)}")
    expect(view).toContain("{control()}")
  })

  it("only exposes Goal controls while the action row is available", () => {
    const dock = read("webview-ui/src/components/chat/SessionDock.tsx")
    const goal = read("webview-ui/src/components/chat/goal/useGoalDock.tsx")
    const indicator = read("webview-ui/src/components/shared/WorkingIndicator.tsx")
    expect(indicator).not.toMatch(/goal|DropdownMenu|Tooltip/)
    expect(dock).toContain("<WorkingIndicator onScrollToBottom={props.onScrollToBottom} />")
    expect(goal).toContain('class="session-goal-action"')
    expect(goal).toContain('variant="ghost"')
    expect(goal).toContain("disabled={props.readonly || !actions()}")
    expect(goal).toContain("if (!actions() || !goal()) setOpen(false)")
    expect(dock).toContain("props.actions?.(goal.control)")
    expect(dock).toContain("const goal = useGoalDock({")
    expect(goal).toContain('session.sendCommand("goal", goal().active ? "pause" : "resume")')
    expect(goal).toContain('session.sendCommand("goal", "clear")')
    expect(read("webview-ui/src/components/chat/PromptInput.tsx")).not.toContain('"session.goal.label"')
    const working = dock.match(/const working = \(\) =>([^\n]*)/)?.[1]
    expect(working).not.toContain("goal()")
    expect(dock).toContain("const active = () => working() || actions()")
    expect(goal).toContain("working() && goal()?.active")
    expect(dock).toContain("{goal.status()}")
  })

  it("shares action button styles without modifying the loading indicator", () => {
    const layout = read("webview-ui/src/styles/chat-layout.css")
    const css = layout + read("webview-ui/src/styles/goal.css")
    expect(layout).not.toContain(".session-goal-")
    expect(read("webview-ui/src/styles/chat.css")).toContain('@import "./goal.css"')
    const indicator = css.match(/\.working-indicator \{([\s\S]*?)\}/)?.[1]
    expect(css).not.toContain('.session-goal-action[data-component="button"]')
    expect(css).not.toContain(".session-dock[data-goal]")
    expect(css).toContain(".session-goal-status")
    expect(css).not.toContain(".session-goal-dot")
    expect(css).not.toContain("@container chat (max-width: 640px)")
    expect(indicator).toContain("gap: 8px")
    expect(indicator).toContain("padding: 4px 10px")
    expect(css).not.toContain("working-goal")
    expect(css).not.toContain(".working-indicator[data-goal]")
  })

  it("keeps the working status accessible and constrained", () => {
    const indicator = read("webview-ui/src/components/shared/WorkingIndicator.tsx")
    const css = read("webview-ui/src/styles/chat-layout.css")
    expect(indicator).toContain('<span class="sr-only">{language.t("session.messages.scrollToBottom")}</span>')
    const button = css.match(/\.working-indicator-scroll\[data-component="button"\] \{([\s\S]*?)\}/)
    expect(button).not.toBeNull()
    expect(button![1]).toContain("max-width: 100%")
    expect(button![1]).toContain("min-width: 0")
    expect(css).toContain(".working-indicator-scroll:hover:not(:disabled)")
    expect(css).toContain("var(--surface-interactive-hover, var(--vscode-list-hoverBackground))")
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
