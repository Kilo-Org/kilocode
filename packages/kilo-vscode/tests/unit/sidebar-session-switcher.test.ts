import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(__dirname, "..", "..", "webview-ui", "src")
const header = readFileSync(join(root, "components", "chat", "TaskHeader.tsx"), "utf8")
const view = readFileSync(join(root, "components", "chat", "ChatView.tsx"), "utf8")
const switcher = readFileSync(join(root, "components", "chat", "SessionTabSwitcher.tsx"), "utf8")
const tabs = readFileSync(join(root, "context", "local-tabs.tsx"), "utf8")

describe("sidebar session switcher", () => {
  it("renders the switcher in the session header instead of a tab strip", () => {
    expect(view).not.toContain("<SessionTabStrip")
    expect(view).toContain("sessionSwitcher={isSidebar() && !props.readonly}")
    expect(header).toContain('data-slot="task-header-session-switcher"')
    expect(header).toContain("<SessionTabSwitcher")
    expect(switcher).toContain('icon: "bullet-list"')
  })

  it("opens on hover and closes when the pointer leaves the switcher", () => {
    expect(header).toContain("hover")
    expect(switcher).toContain("onPointerEnter: show")
    expect(switcher).toContain("onPointerLeave: schedule")
    expect(switcher).toContain("onPointerLeave={hide}")
  })

  it("keeps tab selection and closing wired through local tabs", () => {
    expect(header).toContain("onSelect={tab().select}")
    expect(header).toContain("onClose={tab().close}")
    expect(header).toContain("tabs.ids().length > 0")
  })

  it("persists real order and active tab through VS Code webview state", () => {
    expect(tabs).toContain("sidebarSessionTabIDs: tabs")
    expect(tabs).toContain("sidebarActiveSessionTabID: selected")
    expect(tabs).toContain("timer = setTimeout(persist, 300)")
  })
})
