/**
 * Structural tests for PasteModal terminal branch.
 * Per CONVENTIONS.md: no KeyboardEvent dispatch under Bun; source introspection only.
 * Verifies Phase 5 unstub: class="terminal-stub" must not appear.
 */
import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

const SRC = readFileSync(
  path.resolve(import.meta.dir, "../paste-modal/index.tsx"),
  "utf-8",
)

describe("PasteModal terminal branch (Phase 5 unstub)", () => {
  it("no longer contains terminal-stub class marker", () => {
    expect(SRC).not.toContain('class="terminal-stub"')
  })

  it("has single-line caveat comment (OpenTUI has no textarea)", () => {
    expect(SRC).toContain("OpenTUI has no")
    expect(SRC).toContain("textarea")
  })

  it("has TerminalPasteModal function for terminal branch", () => {
    expect(SRC).toContain("TerminalPasteModal")
  })

  it("has TerminalPasteModal with useKeyboard and label", () => {
    // Terminal branch uses <text> (SVG-compatible) with summary label
    expect(SRC).toContain("TerminalPasteModal")
    expect(SRC).toContain("label")
  })

  it("imports @opentui/solid (dynamic require inside TerminalPasteModal)", () => {
    expect(SRC).toContain("@opentui/solid")
  })

  it("ESC handling via useKeyboard in terminal branch", () => {
    expect(SRC).toContain("useKeyboard")
    expect(SRC).toContain('"Escape"')
  })

  it("PHASE-5-TODO comment removed", () => {
    expect(SRC).not.toContain("PHASE-5-TODO")
  })

  it("DOM branch still present with textarea", () => {
    expect(SRC).toContain("<textarea")
    expect(SRC).toContain('aria-label="Paste text"')
  })

  it("exports PasteModal function", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("../paste-modal/index.tsx")
    expect(typeof mod.PasteModal).toBe("function")
  })

  it("no top-level @opentui static import (CONVENTIONS.md §3)", () => {
    const lines = SRC.split("\n")
    const topLevelOpentui = lines.filter(
      (l) => l.includes('from "@opentui') && !l.trim().startsWith("//"),
    )
    expect(topLevelOpentui.length).toBe(0)
  })
})
