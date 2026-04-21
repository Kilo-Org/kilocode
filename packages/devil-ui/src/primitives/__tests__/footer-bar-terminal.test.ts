/**
 * Structural tests for FooterBar terminal branch.
 * Per CONVENTIONS.md: no KeyboardEvent dispatch under Bun; source introspection only.
 * Verifies Phase 5 unstub: class="terminal-stub" must not appear.
 */
import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

const SRC = readFileSync(
  path.resolve(import.meta.dir, "../footer-bar/index.tsx"),
  "utf-8",
)

describe("FooterBar terminal branch (Phase 5 unstub)", () => {
  it("no longer contains terminal-stub class marker", () => {
    expect(SRC).not.toContain('class="terminal-stub"')
  })

  it("has terminal branch rendering keybind hints as text", () => {
    // Terminal branch uses <text> (SVG-compatible) for type safety
    expect(SRC).toContain("terminalSummary")
    expect(SRC).toContain("terminalBranch")
  })

  it("renders keybind binding and title in terminal summary", () => {
    expect(SRC).toContain("action.keybind")
    expect(SRC).toContain("action.title")
  })

  it("uses createMemo for terminal summary computation", () => {
    expect(SRC).toContain("terminalSummary = createMemo")
  })

  it("hint format includes binding in brackets", () => {
    // Terminal hint format: [binding] title
    expect(SRC).toContain("`[${action.keybind")
  })

  it("uses useCommandRegistry to build hints", () => {
    expect(SRC).toContain("useCommandRegistry")
    // registry.search may be split across lines
    expect(SRC).toContain(".search(")
  })

  it("DOM branch still present with footer element", () => {
    expect(SRC).toContain("<footer")
    expect(SRC).toContain("role=\"status\"")
  })

  it("exports FooterBar function", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("../footer-bar/index.tsx")
    expect(typeof mod.FooterBar).toBe("function")
  })

  it("no top-level @opentui static import (CONVENTIONS.md §3)", () => {
    const lines = SRC.split("\n")
    const topLevelOpentui = lines.filter(
      (l) => l.includes('from "@opentui') && !l.trim().startsWith("//"),
    )
    expect(topLevelOpentui.length).toBe(0)
  })

  it("handles empty hints state gracefully", () => {
    // Terminal branch returns empty string when no hints (hs.length === 0)
    expect(SRC).toContain("length === 0")
  })
})
