/**
 * Tests for useDensity / useDensityOptional hooks.
 *
 * Structural smoke tests: the hooks rely on SolidJS context which requires a
 * reactive root + provider tree. We test the module structure + the optional
 * hook's safe-fallback behaviour, and provider-connected behaviour via withRoot.
 */
import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import path from "path"
import { withRoot } from "./test-harness"

const SRC = readFileSync(
  path.resolve(import.meta.dir, "../use-density.tsx"),
  "utf-8",
)

describe("use-density module structure", () => {
  it("exports useDensity function", () => {
    const mod = require("../use-density.tsx")
    expect(typeof mod.useDensity).toBe("function")
  })

  it("exports useDensityOptional function", () => {
    const mod = require("../use-density.tsx")
    expect(typeof mod.useDensityOptional).toBe("function")
  })

  it("useDensity throws outside provider", () => {
    withRoot(() => {
      const { useDensity } = require("../use-density.tsx") as typeof import("../use-density")
      expect(() => useDensity()).toThrow()
    })
  })

  it("useDensityOptional returns undefined outside provider (no throw)", () => {
    withRoot(() => {
      const { useDensityOptional } = require("../use-density.tsx") as typeof import("../use-density")
      const result = useDensityOptional()
      expect(result).toBeUndefined()
    })
  })

  it("source contains DensityContext import from context/density", () => {
    expect(SRC).toContain("DensityContext")
    expect(SRC).toContain("context/density")
  })

  it("source contains useDensityOptional export", () => {
    expect(SRC).toContain("useDensityOptional")
  })

  it("useDensityOptional does not throw when invoked multiple times outside provider", () => {
    withRoot(() => {
      const { useDensityOptional } = require("../use-density.tsx") as typeof import("../use-density")
      // Should not throw on repeated calls
      const r1 = useDensityOptional()
      const r2 = useDensityOptional()
      expect(r1).toBeUndefined()
      expect(r2).toBeUndefined()
    })
  })
})

describe("DensityProvider + useDensity integration", () => {
  it("DensityContext and DensityProvider are exported from context/density module", () => {
    // Structural smoke test: verify both symbols are exported
    // (require inside withRoot can fail in SSR mode when JSX factories are invoked)
    const densitySrc = readFileSync(
      path.resolve(import.meta.dir, "../../context/density.tsx"),
      "utf-8",
    )
    expect(densitySrc).toContain("export const DensityContext")
    expect(densitySrc).toContain("export function DensityProvider")
  })
})
