/**
 * Tests for plan_exit webview helpers:
 *  - planDisplayPath: relative/absolute path display logic
 *  - plan_exit renderer uses openFile, not openDiff
 */

import { describe, expect, it } from "bun:test"
import { planDisplayPath } from "../../webview-ui/src/utils/plan-path"
import fs from "node:fs"
import path from "node:path"

describe("planDisplayPath", () => {
  it("returns a relative path unchanged", () => {
    expect(planDisplayPath(".kilo/plans/my-plan.md", "/repo")).toBe(".kilo/plans/my-plan.md")
  })

  it("returns absolute path inside repo as repo-relative", () => {
    expect(planDisplayPath("/repo/.kilo/plans/my-plan.md", "/repo")).toBe(".kilo/plans/my-plan.md")
  })

  it("returns absolute path inside repo with trailing slash on root as repo-relative", () => {
    expect(planDisplayPath("/repo/.kilo/plans/my-plan.md", "/repo/")).toBe(".kilo/plans/my-plan.md")
  })

  it("returns absolute path outside repo unchanged", () => {
    expect(planDisplayPath("/other/path/plan.md", "/repo")).toBe("/other/path/plan.md")
  })

  it("handles Windows absolute paths inside root", () => {
    expect(planDisplayPath("C:\\repo\\.kilo\\plans\\plan.md", "C:\\repo")).toBe(".kilo\\plans\\plan.md")
  })

  it("handles Windows absolute paths outside root", () => {
    expect(planDisplayPath("D:\\other\\plan.md", "C:\\repo")).toBe("D:\\other\\plan.md")
  })

  it("returns empty string unchanged", () => {
    expect(planDisplayPath("", "/repo")).toBe("")
  })

  it("path equal to root returns original", () => {
    // Edge: plan path IS the root directory itself — fall back to original
    expect(planDisplayPath("/repo", "/repo")).toBe("/repo")
  })
})

describe("plan_exit renderer uses openFile not openDiff (source)", () => {
  const ROOT = path.resolve(import.meta.dir, "../..")
  const FILE = path.join(ROOT, "webview-ui/src/components/chat/AssistantMessage.tsx")
  const TURN_FILE = path.join(ROOT, "webview-ui/src/components/chat/VscodeSessionTurn.tsx")
  const src = fs.readFileSync(FILE, "utf-8")
  const turnSrc = fs.readFileSync(TURN_FILE, "utf-8")

  it("PlanExitCard calls data.openFile", () => {
    expect(src).toContain("data.openFile")
  })

  it("uses a safe inert anchor href", () => {
    expect(src).toContain('href="#"')
    expect(src).not.toContain("href={display()}")
  })

  it("always uses the generic ready label", () => {
    expect(src).toContain('language.t("plan.exit.ready")')
    expect(src).not.toContain('language.t("plan.exit.readyUpdated")')
    expect(src).not.toContain('language.t("plan.exit.readyNew")')
  })

  it("does not infer status from tool history", () => {
    expect(src).not.toContain("function inferPlanStatus")
    expect(src).not.toContain("function patchUpdatedPlan")
    expect(src).not.toContain("function toolTouchesPlan")
    expect(src).not.toContain("toolDeletions")
    expect(src).not.toContain("readyUpdated")
    expect(src).not.toContain("readyNew")
    expect(src).not.toContain("Object.values(data.store.part ?? {}).flat()")
    expect(src).not.toContain("[...props.parts, ...all()]")
    expect(src).not.toContain("turnParts")
    expect(turnSrc).not.toContain("assistantMessages().flatMap")
    expect(turnSrc).not.toContain("turnParts={assistantParts()}")
  })

  it("does not depend on opencode-provided plan status metadata", () => {
    expect(src).not.toContain('meta.status === "updated" || meta.status === "new"')
    expect(src).not.toContain("meta.status")
  })

  it("PlanExitCard does not call openDiffVirtual", () => {
    // Extract just the PlanExitCard function body to scope the assertion
    const start = src.indexOf("function PlanExitCard")
    const end = src.indexOf("\nfunction ", start + 1)
    const block = end === -1 ? src.slice(start) : src.slice(start, end)
    expect(block).not.toContain("openDiffVirtual")
    expect(block).not.toContain("openDiff")
  })

  it("plan_exit tool is handled before generic Part renderer", () => {
    const planExitIdx = src.indexOf("planExit()")
    // <Part may be followed by newline or space
    const partIdx = src.search(/<Part[\s\n]/)
    expect(planExitIdx).toBeGreaterThan(0)
    expect(partIdx).toBeGreaterThan(0)
    expect(planExitIdx).toBeLessThan(partIdx)
  })
})
