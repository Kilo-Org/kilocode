/**
 * Structural tests for CommandPalette terminal branch.
 * Per CONVENTIONS.md: no KeyboardEvent dispatch under Bun; source introspection only.
 * Verifies Phase 5 unstub: class="terminal-stub" must not appear, @opentui import must exist.
 */
import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

const SRC = readFileSync(
  path.resolve(import.meta.dir, "../command-palette/index.tsx"),
  "utf-8",
)

describe("CommandPalette terminal branch (Phase 5 unstub)", () => {
  it("no longer contains terminal-stub class marker", () => {
    expect(SRC).not.toContain('class="terminal-stub"')
  })

  it("imports @opentui/solid (dynamic require inside TerminalCommandPalette)", () => {
    expect(SRC).toContain("@opentui/solid")
  })

  it("has TerminalCommandPalette function for terminal branch", () => {
    expect(SRC).toContain("TerminalCommandPalette")
  })

  it("uses useCommandRegistry for search in terminal branch", () => {
    expect(SRC).toContain("useCommandRegistry")
    expect(SRC).toContain("registry.search")
    expect(SRC).toContain("registry.entries()")
  })

  it("renders results with For and cmd.title in terminal branch", () => {
    expect(SRC).toContain("cmd.title")
    expect(SRC).toContain("<For each={results()}>")
  })

  it("shows empty state when no results", () => {
    expect(SRC).toContain("no matches")
  })

  it("DOM branch still present (not regressed)", () => {
    expect(SRC).toContain('role="dialog"')
    expect(SRC).toContain('aria-modal="true"')
  })

  it("ESC handling via useKeyboard in terminal branch", () => {
    expect(SRC).toContain("useKeyboard")
    expect(SRC).toContain('"Escape"')
  })

  it("exports CommandPalette function", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("../command-palette/index.tsx")
    expect(typeof mod.CommandPalette).toBe("function")
  })

  it("no top-level @opentui static import (CONVENTIONS.md §3)", () => {
    const lines = SRC.split("\n")
    const topLevelOpentui = lines.filter(
      (l) => l.includes('from "@opentui') && !l.trim().startsWith("//"),
    )
    expect(topLevelOpentui.length).toBe(0)
  })
})
