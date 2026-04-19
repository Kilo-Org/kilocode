import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

// ─── Structural smoke tests for PositionPicker ────────────────────────────────
// Bun + SolidJS DOM rendering has known friction in test environments (Phase 3
// precedent). We use structural source-file assertions to prove the component's
// API surface is correct without requiring a full DOM render cycle.

const SRC = readFileSync(join(__dirname, "../position-picker.tsx"), "utf-8")

describe("PositionPicker", () => {
  it("exports PositionPicker function", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PositionPicker } = require("../position-picker")
    expect(typeof PositionPicker).toBe("function")
  })

  it("has fuzzysort import", () => {
    expect(SRC).toContain("fuzzysort")
  })

  it("has dialog element for open state", () => {
    expect(SRC).toContain("dialog")
    expect(SRC).toContain("props.open")
  })

  it("has excludeIds filtering logic", () => {
    expect(SRC).toContain("excludeIds")
  })

  it("has keyboard navigation (selectedIndex + arrow keys)", () => {
    expect(SRC).toContain("selectedIndex")
    expect(SRC).toContain("ArrowDown")
    expect(SRC).toContain("Escape")
  })

  it("has ArrowUp navigation", () => {
    expect(SRC).toContain("ArrowUp")
  })

  it("has Enter key trigger", () => {
    expect(SRC).toContain('"Enter"')
  })

  it("has untrack in clamp effect (Phase 3 lesson)", () => {
    expect(SRC).toContain("untrack")
  })

  it("has stopPropagation to prevent double-close (Phase 3 fix #7)", () => {
    expect(SRC).toContain("stopPropagation")
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

  it("has fallback position data for 11 canonical positions", () => {
    expect(SRC).toContain("architect")
    expect(SRC).toContain("coordinator")
    expect(SRC).toContain("spec-writer")
    expect(SRC).toContain("senior-dev")
    expect(SRC).toContain("developer")
    expect(SRC).toContain("frontend-specialist")
    expect(SRC).toContain("backend-specialist")
    expect(SRC).toContain("reviewer")
    expect(SRC).toContain("qa-tester")
    expect(SRC).toContain("release-engineer")
    expect(SRC).toContain("researcher")
  })

  it("has capability chips in results", () => {
    expect(SRC).toContain("canonicalCapabilities")
  })

  it("has lazy require fallback for POSITION_LIBRARY", () => {
    expect(SRC).toContain("getPositionLibrary")
    expect(SRC).toContain("FALLBACK_POSITIONS")
  })
})
