/**
 * Structural tests for HelpOverlay terminal branch.
 * Per CONVENTIONS.md: no KeyboardEvent dispatch under Bun; source introspection only.
 * Verifies Phase 5 unstub: class="terminal-stub" must not appear.
 */
import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

const SRC = readFileSync(
  path.resolve(import.meta.dir, "../help-overlay/index.tsx"),
  "utf-8",
)

describe("HelpOverlay terminal branch (Phase 5 unstub)", () => {
  it("no longer contains terminal-stub class marker", () => {
    expect(SRC).not.toContain('class="terminal-stub"')
  })

  it("imports @opentui/solid (dynamic require inside TerminalHelpOverlay)", () => {
    expect(SRC).toContain("@opentui/solid")
  })

  it("has TerminalHelpOverlay function for terminal branch", () => {
    expect(SRC).toContain("TerminalHelpOverlay")
  })

  it("uses useCommandRegistry (not a call to useKeybindRegistry) for keybind grouping", () => {
    expect(SRC).toContain("useCommandRegistry")
    // useKeybindRegistry does not exist — must not be called as a function
    expect(SRC).not.toContain("useKeybindRegistry()")
  })

  it("groups commands by scope using byScope record", () => {
    expect(SRC).toContain("byScope")
    expect(SRC).toContain("c.keybind")
  })

  it("ESC handling via useKeyboard in terminal branch", () => {
    expect(SRC).toContain("useKeyboard")
    expect(SRC).toContain('"Escape"')
  })

  it("renders scope groups with For", () => {
    expect(SRC).toContain("groups()")
    expect(SRC).toContain("<For each={groups()}>")
  })

  it("DOM branch still present (not regressed)", () => {
    expect(SRC).toContain('role="dialog"')
    expect(SRC).toContain("Keyboard Shortcuts")
  })

  it("exports HelpOverlay function", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("../help-overlay/index.tsx")
    expect(typeof mod.HelpOverlay).toBe("function")
  })

  it("no top-level @opentui static import (CONVENTIONS.md §3)", () => {
    const lines = SRC.split("\n")
    const topLevelOpentui = lines.filter(
      (l) => l.includes('from "@opentui') && !l.trim().startsWith("//"),
    )
    expect(topLevelOpentui.length).toBe(0)
  })
})
