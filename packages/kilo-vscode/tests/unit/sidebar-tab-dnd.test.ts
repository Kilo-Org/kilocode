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
    expect(strip).toContain("<SortableProvider ids={tabs.ids()}>")
    expect(strip).toContain("<SortableTabContainer id={id}>")
  })

  it("reorders while dragging and persists on drag end", () => {
    expect(strip).toContain("tabs.reorder(from, to)")
    expect(strip).toMatch(/const dragEnd = \(\) => \{[\s\S]*tabs\.persist\(\)/)
  })

  it("supports keyboard reorder without replacing selection navigation", () => {
    expect(strip).toContain('tabs.move(id, event.key === "ArrowLeft" ? -1 : 1)')
    expect(strip).toContain("handleTabKey({ ids: tabs.ids(), id, event, select: tabs.select, root })")
    expect(strip).toContain('aria-live="polite"')
  })

  it("persists real order and active tab through VS Code webview state", () => {
    expect(tabs).toContain("sidebarSessionTabIDs: tabs")
    expect(tabs).toContain("sidebarActiveSessionTabID: selected")
    expect(tabs).toContain("timer = setTimeout(persist, 300)")
  })

  it("releases frozen widths after closing and after dragging", () => {
    expect(strip.match(/requestAnimationFrame\(release\)/g)).toHaveLength(2)
    expect(strip).toMatch(/const dragEnd = \(\) => \{[\s\S]*release\(\)/)
  })
})
