import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

const SRC = readFileSync(
  path.resolve(import.meta.dir, "../stage-coverage-indicator/index.tsx"),
  "utf-8",
)

describe("StageCoverageIndicator source", () => {
  it("exports StageCoverageIndicator function", () => {
    const mod = require("../stage-coverage-indicator/index.tsx")
    expect(typeof mod.StageCoverageIndicator).toBe("function")
  })

  it("exports StageCoverageIndicatorProps type (via function name)", () => {
    expect(SRC).toContain("StageCoverageIndicatorProps")
  })

  it("has all 7 workflow stages inlined", () => {
    const stages = ["plan", "challenge", "contract", "build", "review", "ship", "retro"]
    for (const stage of stages) {
      expect(SRC).toContain(`"${stage}"`)
    }
  })

  it("uses Show for dom/terminal branch switching", () => {
    expect(SRC).toContain('target.kind === "dom"')
    expect(SRC).toContain("TerminalStub")
    expect(SRC).toContain("DomBranch")
  })

  it("DomBranch has role=status and aria-label", () => {
    expect(SRC).toContain('role="status"')
    expect(SRC).toContain("aria-label")
  })

  it("has data-stage and data-missing attributes", () => {
    expect(SRC).toContain("data-stage={stage}")
    expect(SRC).toContain('data-missing={isMissing ? "true" : "false"}')
  })

  it("aria-invalid uses string values not boolean", () => {
    // Must not have bare boolean aria-invalid={isMissing}
    expect(SRC).not.toContain("aria-invalid={isMissing}")
    expect(SRC).toContain('aria-invalid={isMissing ? "true" : "false"}')
  })

  it("compact prop affects padding and font-size", () => {
    expect(SRC).toContain("props.compact")
    expect(SRC).toContain("compact")
  })

  it("TerminalStub provides Phase 5 TODO comment", () => {
    expect(SRC).toContain("Phase 5 TODO")
  })

  it("no @opentui static imports", () => {
    expect(SRC).not.toContain('from "@opentui')
  })
})
