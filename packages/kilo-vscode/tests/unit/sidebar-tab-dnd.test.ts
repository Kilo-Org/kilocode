import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(__dirname, "..", "..", "webview-ui", "src")
const strip = readFileSync(join(root, "components", "chat", "SessionTabStrip.tsx"), "utf8")
const tabs = readFileSync(join(root, "context", "local-tabs.tsx"), "utf8")

describe("sidebar tab drag ordering", () => {
  it("uses shared pointer DnD and sortable tab primitives", () => {
    expect(strip).toContain("<DragDropProvider")
    expect(strip).toContain("<DragDropSensors />")
    expect(strip).toContain("<ConstrainDragYAxis />")
    expect(strip).toContain("<SortableProvider ids={tabs.display()}>")
    expect(strip).toContain("<SortableTabContainer id={id}>")
  })

  it("reorders while dragging and persists on drag end", () => {
    expect(strip).toContain("tabs.reorder(from, to)")
    expect(strip).toMatch(/const dragEnd = \(\) => \{[\s\S]*tabs\.persist\(\)/)
  })

  it("supports keyboard reorder without replacing selection navigation", () => {
    expect(strip).toContain('tabs.move(id, event.key === "ArrowLeft" ? -1 : 1)')
    expect(strip).toContain("handleTabKey({ ids: tabs.display(), id, event, select: tabs.select, root })")
    expect(strip).toContain('aria-live="polite"')
  })

  it("persists real order, active tab, and pins through VS Code webview state", () => {
    expect(tabs).toContain("sidebarSessionTabIDs: tabs")
    expect(tabs).toContain("sidebarActiveSessionTabID: selected")
    expect(tabs).toContain("sidebarPinnedSessionTabIDs: pins")
    expect(tabs).toContain("const pins = pinned().filter((id) => real().includes(id))")
    expect(tabs).toContain("timer = setTimeout(persist, 300)")
  })

  it("releases frozen widths after closing, close to right, and dragging", () => {
    expect(strip.match(/requestAnimationFrame\(release\)/g)).toHaveLength(3)
    expect(strip).toMatch(/const closeRight = \(id: string\) => \{[\s\S]*requestAnimationFrame\(release\)/)
    expect(strip).toMatch(/const dragEnd = \(\) => \{[\s\S]*release\(\)/)
  })
})
