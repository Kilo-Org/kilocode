import { describe, expect, it } from "bun:test"
import { buildShortcutCategories } from "../../webview-ui/agent-manager/shortcuts"

describe("Agent Manager shortcut map", () => {
  it("includes sidebar search in the quick-switch section", () => {
    const categories = buildShortcutCategories({ search: "⌘F", jumpTo1: "⌘1" }, (key) => key)
    expect(categories[0]?.shortcuts[0]).toEqual({
      label: "agentManager.sidebarSearch.label",
      binding: "⌘F",
    })
  })

  it("includes open pull request in the sidebar section", () => {
    const categories = buildShortcutCategories({ openPR: "⌘⇧R" }, (key) => key)
    expect(categories[1]?.shortcuts).toContainEqual({
      label: "agentManager.shortcuts.openPR",
      binding: "⌘⇧R",
    })
  })
})
