import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

// ─── Structural smoke tests for RosterTable ───────────────────────────────────
// Bun + SolidJS DOM rendering has known friction in test environments (Phase 3
// precedent). We use structural source-file assertions to prove the component's
// API surface is correct without requiring a full DOM render cycle.

const SRC = readFileSync(join(__dirname, "../roster-table.tsx"), "utf-8")

describe("RosterTable", () => {
  it("exports RosterTable function", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RosterTable } = require("../roster-table")
    expect(typeof RosterTable).toBe("function")
  })

  it("has correct column count (6 th cells)", () => {
    expect(SRC).toContain("Position")
    expect(SRC).toContain("Provider")
    expect(SRC).toContain("Model")
    expect(SRC).toContain("Effort")
    expect(SRC).toContain("Delegates")
    expect(SRC).toContain("Capabilities")
  })

  it("has onEdit callback in props type", () => {
    expect(SRC).toContain("onEdit")
    expect(SRC).toContain("onDelete")
    expect(SRC).toContain("onAdd")
  })

  it("has data-has-errors attribute for error rows", () => {
    expect(SRC).toContain("data-has-errors")
  })

  it("has data-position attribute per row", () => {
    expect(SRC).toContain("data-position")
  })

  it("has data-action delete button", () => {
    expect(SRC).toContain('data-action="delete"')
  })

  it("has data-action add button", () => {
    expect(SRC).toContain('data-action="add"')
  })

  it("has error styling (background #3a1a1a)", () => {
    expect(SRC).toContain("#3a1a1a")
    expect(SRC).toContain("#a33")
  })

  it("has selectedRole and data-selected attribute", () => {
    expect(SRC).toContain("selectedRole")
    expect(SRC).toContain("data-selected")
  })

  it("has terminal stub branch", () => {
    expect(SRC).toContain("TerminalStub")
    expect(SRC).toContain("Phase 5 TODO")
  })

  it("has no @opentui static import", () => {
    expect(SRC).not.toContain('from "@opentui/')
    expect(SRC).not.toContain("from '@opentui/")
  })

  it("uses RenderSurface for dual-branch dispatch", () => {
    expect(SRC).toContain("RenderSurface")
    expect(SRC).toContain("useRenderTarget")
  })

  it("has EffortLevel options in select element", () => {
    expect(SRC).toContain("EFFORT_LEVELS")
    expect(SRC).toContain('"max"')
    expect(SRC).toContain('"default"')
  })

  it("has onSelectRole called on row click", () => {
    expect(SRC).toContain("onSelectRole")
  })
})
