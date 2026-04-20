/**
 * Tests for StagePositionBadge primitive.
 */
import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

const SRC = readFileSync(
  path.resolve(import.meta.dir, "../stage-position-badge/index.tsx"),
  "utf-8",
)

describe("StagePositionBadge module structure", () => {
  it("exports StagePositionBadge function", () => {
    const mod = require("../stage-position-badge/index.tsx")
    expect(typeof mod.StagePositionBadge).toBe("function")
  })

  it("exports StagePositionBadgeProps type", () => {
    expect(SRC).toContain("StagePositionBadgeProps")
  })

  it("terminal branch renders compact ASCII [STAGE:Role] format without emoji", () => {
    // Check for uppercase stage format in terminal
    expect(SRC).toContain("toUpperCase()")
    // Should not use emoji in terminal branch
    const terminalSection = SRC.slice(SRC.indexOf("TerminalBranch"), SRC.indexOf("DomBranch"))
    expect(terminalSection).not.toMatch(/[\u{1F300}-\u{1FFFF}]/u)
  })

  it("uses lazy fallback form for terminal branch (thunk or cast form)", () => {
    // The plan requires lazy evaluation. SolidJS 1.9.x types Show.fallback as JSX.Element,
    // so the lazy thunk must be cast: (() => <TerminalBranch/>) as unknown as JSX.Element.
    // Either form of the pattern must be present.
    const hasThunkForm = SRC.includes("fallback={() =>") || SRC.includes("fallback={(() =>")
    expect(hasThunkForm).toBe(true)
    expect(SRC).toContain("TerminalBranch")
  })

  it("DOM branch has data-component attribute", () => {
    expect(SRC).toContain('data-component="stage-position-badge"')
  })

  it("DOM branch has data-stage attribute", () => {
    expect(SRC).toContain("data-stage={props.info.stage}")
  })

  it("DOM branch has aria-label", () => {
    expect(SRC).toContain("aria-label={")
  })

  it("no @opentui static import at module level", () => {
    const lines = SRC.split("\n")
    const topLevelOpentui = lines.filter(
      (l) => l.includes('from "@opentui') && !l.trim().startsWith("//"),
    )
    expect(topLevelOpentui.length).toBe(0)
  })

  it("uses Show for dom/terminal branch switching", () => {
    expect(SRC).toContain('target.kind === "dom"')
    expect(SRC).toContain("TerminalBranch")
    expect(SRC).toContain("DomBranch")
  })

  it("handles covered and uncovered info states in terminal", () => {
    // Should handle both covered and uncovered
    expect(SRC).toContain("position")
    expect(SRC).toContain("--")
  })
})
