// A terminal tab stays mounted while other tabs become visible. Its selection state has to follow the visible tab:
// a captured value left a hidden terminal tab `aria-selected` and in the tab order, so closing a tab with Cmd+W moved
// keyboard focus to that hidden terminal tab instead of the tab on screen.
import { describe, expect, it } from "bun:test"
import { terminalTabDeps } from "../webview-ui/agent-manager/terminal-tab-deps"
import type { TerminalTabSource } from "../webview-ui/agent-manager/terminal-tab-deps"

describe("terminal tab entry", () => {
  it("follows the visible tab after it was created", () => {
    let visible = "terminal:one"
    const deps = {
      visibleTabId: () => visible,
      tabIds: () => ["terminal:one", "pending:two"],
      kb: () => ({}),
      adjacentHint: () => "",
      REVIEW_TAB_ID: "review",
      isPinned: () => false,
    } as unknown as TerminalTabSource

    const entry = terminalTabDeps("terminal:one", deps)
    expect(entry.selected).toBe(true)
    expect(entry.tabIndex).toBe(0)

    visible = "pending:two"
    expect(entry.selected).toBe(false)
    expect(entry.tabIndex).toBe(-1)
  })
})
