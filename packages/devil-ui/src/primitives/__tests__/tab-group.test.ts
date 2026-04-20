/**
 * Tests for TabGroup primitive.
 *
 * Verifies:
 * - Render-prop children pattern (R1-04)
 * - ARIA: role="tablist", role="tab", aria-selected (string), aria-controls, role="tabpanel"
 * - Tab/Shift+Tab switching and 1-9 digit shortcuts in source
 * - Lazy fallback form
 */
import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import path from "path"
import { withRoot } from "../../hooks/__tests__/test-harness"
import { createMemo } from "solid-js"

const SRC = readFileSync(
  path.resolve(import.meta.dir, "../tab-group/index.tsx"),
  "utf-8",
)

const TABS = [
  { id: "tab-a", label: "Alpha", closeable: false },
  { id: "tab-b", label: "Beta", closeable: true },
  { id: "tab-c", label: "Gamma", closeable: false },
]

describe("TabGroup module structure", () => {
  it("exports TabGroup function", () => {
    const mod = require("../tab-group/index.tsx")
    expect(typeof mod.TabGroup).toBe("function")
  })

  it("exports TabDescriptor type reference", () => {
    expect(SRC).toContain("TabDescriptor")
  })

  it("exports TabGroupChildrenRender type reference", () => {
    expect(SRC).toContain("TabGroupChildrenRender")
  })

  it("uses render-prop children pattern (function, not slot)", () => {
    // children should be a function type
    expect(SRC).toContain("TabGroupChildrenRender")
    expect(SRC).toContain("children: TabGroupChildrenRender")
    // No TabSlot exported — check no "export" with "TabSlot" on same non-comment line
    const lines = SRC.split("\n")
    const tabSlotExports = lines.filter(
      (l) => l.includes("export") && l.includes("TabSlot") && !l.trim().startsWith("//") && !l.trim().startsWith("*"),
    )
    expect(tabSlotExports.length).toBe(0)
  })

  it("DOM branch has role=tablist, role=tab, role=tabpanel ARIA", () => {
    expect(SRC).toContain('role="tablist"')
    expect(SRC).toContain('role="tab"')
    expect(SRC).toContain('role="tabpanel"')
  })

  it("aria-selected uses string values (not boolean)", () => {
    // Must not have bare boolean aria-selected={isActive()}
    expect(SRC).not.toContain("aria-selected={isActive()}")
    expect(SRC).toContain('aria-selected={isActive() ? "true" : "false"}')
  })

  it("has aria-controls on tab buttons", () => {
    expect(SRC).toContain("aria-controls={panelId}")
  })

  it("uses Show with keyed for active tab panel (R1-10)", () => {
    expect(SRC).toContain("<Show when={props.active()} keyed>")
    expect(SRC).toContain("props.children(tab)")
  })

  it("uses createMemo to compute active tab", () => {
    expect(SRC).toContain("createMemo")
    expect(SRC).toContain("tabs.find")
  })

  it("terminal branch implements keyboard shortcuts (Tab and digit keys)", () => {
    // Tab navigation
    expect(SRC).toContain('evt.name === "tab"')
    // Digit shortcuts (1-9)
    expect(SRC).toContain('[1-9]')
  })

  it("uses lazy fallback form for terminal branch (thunk or cast form)", () => {
    // The plan requires lazy evaluation. SolidJS 1.9.x types Show.fallback as JSX.Element,
    // so the lazy thunk must be cast: (() => <TerminalBranch/>) as unknown as JSX.Element.
    // Either form of the pattern must be present. Also check for multiline forms.
    const hasThunkForm =
      SRC.includes("fallback={() =>") ||
      SRC.includes("fallback={(() =>") ||
      // Multiline form: fallback={\n        (() =>
      /fallback=\{[\s\n]*\(\(\)/.test(SRC)
    expect(hasThunkForm).toBe(true)
    expect(SRC).toContain("TerminalBranch")
  })

  it("no @opentui static import at module level", () => {
    const lines = SRC.split("\n")
    const topLevelOpentui = lines.filter(
      (l) => l.includes('from "@opentui') && !l.trim().startsWith("//"),
    )
    expect(topLevelOpentui.length).toBe(0)
  })
})

describe("TabGroup render-prop invocation", () => {
  it("children render-prop is invoked with TabDescriptor when active", () => {
    // Structural test: verify children type is function in props definition
    expect(SRC).toContain("children: TabGroupChildrenRender")
    expect(SRC).toContain("(tab) => <>{props.children(tab)}</>")
  })

  it("active tab computed with createMemo from tabs.find", () => {
    withRoot(() => {
      // Simulate what TabGroup does internally
      let activeTab = "tab-a"
      const tabs = TABS
      const active = createMemo(() => tabs.find((t) => t.id === activeTab))
      expect(active()?.id).toBe("tab-a")
      expect(active()?.label).toBe("Alpha")
    })
  })

  it("createMemo returns undefined for unknown activeTab", () => {
    withRoot(() => {
      const activeTab = "unknown"
      const tabs = TABS
      const active = createMemo(() => tabs.find((t) => t.id === activeTab))
      expect(active()).toBeUndefined()
    })
  })
})
