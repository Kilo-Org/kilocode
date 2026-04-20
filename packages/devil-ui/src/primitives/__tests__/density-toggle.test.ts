/**
 * Tests for DensityToggle primitive.
 * Structural smoke tests — verifies module exports and source constraints.
 */
import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

const SRC = readFileSync(
  path.resolve(import.meta.dir, "../density-toggle/index.tsx"),
  "utf-8",
)

describe("DensityToggle module structure", () => {
  it("exports DensityToggle function", () => {
    const mod = require("../density-toggle/index.tsx")
    expect(typeof mod.DensityToggle).toBe("function")
  })

  it("has DOM branch with aria-pressed as string", () => {
    // Must not have boolean aria-pressed={isCompact()}
    expect(SRC).not.toContain('aria-pressed={isCompact()}')
    expect(SRC).toContain('aria-pressed={isCompact() ? "true" : "false"}')
  })

  it("uses lazy fallback form for terminal branch (thunk or cast form)", () => {
    // The plan requires lazy evaluation. SolidJS 1.9.x types Show.fallback as JSX.Element,
    // so the lazy thunk must be cast: (() => <TerminalBranch/>) as unknown as JSX.Element.
    // Either form of the pattern must be present.
    const hasThunkForm = SRC.includes("fallback={() =>") || SRC.includes("fallback={(() =>")
    expect(hasThunkForm).toBe(true)
    expect(SRC).toContain("TerminalBranch")
  })

  it("has data-component attribute in DOM branch", () => {
    expect(SRC).toContain('data-component="density-toggle"')
  })

  it("uses useDensityOptional (no throw outside provider)", () => {
    expect(SRC).toContain("useDensityOptional")
  })

  it("DomBranch has role=button and type=button", () => {
    expect(SRC).toContain('type="button"')
    expect(SRC).toContain('role="button"')
  })

  it("no @opentui static import at module level", () => {
    // @opentui imports are only allowed inside component functions via dynamic require
    const lines = SRC.split("\n")
    const topLevelOpentui = lines.filter(
      (l) => l.includes('from "@opentui') && !l.trim().startsWith("//"),
    )
    expect(topLevelOpentui.length).toBe(0)
  })

  it("exports DensityToggleProps type", () => {
    expect(SRC).toContain("DensityToggleProps")
  })
})
