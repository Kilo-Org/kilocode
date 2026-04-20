/**
 * Structural tests for OnboardingWizard primitive.
 * Per CONVENTIONS.md: structural source assertions only (no DOM render cycle).
 * Covers P5-R1, P5-R2 requirements.
 */
import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

const SRC = readFileSync(
  path.resolve(import.meta.dir, "../onboarding-wizard/index.tsx"),
  "utf-8",
)

describe("OnboardingWizard primitive", () => {
  it("exports OnboardingWizard function", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("../onboarding-wizard/index.tsx")
    expect(typeof mod.OnboardingWizard).toBe("function")
  })

  it("exports OnboardingWizardProps, OnboardingWizardStep, QuickstartEntry types", () => {
    expect(SRC).toContain("OnboardingWizardProps")
    expect(SRC).toContain("OnboardingWizardStep")
    expect(SRC).toContain("QuickstartEntry")
  })

  it("is closed when open=false (Show when={props.open})", () => {
    expect(SRC).toContain("props.open")
    expect(SRC).toContain("<Show when={props.open}>")
  })

  it("step 1 lists all quickstarts via For each={props.quickstarts}", () => {
    expect(SRC).toContain("props.quickstarts")
    expect(SRC).toContain("<For each={props.quickstarts}>")
  })

  it("has pick-to-review step transition (setStep review)", () => {
    expect(SRC).toContain('setStep("review")')
  })

  it("has error state on load rejection (setLoadError)", () => {
    expect(SRC).toContain("loadError")
    expect(SRC).toContain("setLoadError")
  })

  it("Review Start button is disabled when !validation().isValid", () => {
    expect(SRC).toContain("validation().isValid")
    expect(SRC).toContain("disabled={!validation().isValid")
  })

  it("Review Start button is enabled path (aria-disabled false when valid)", () => {
    expect(SRC).toContain('aria-disabled={validation().isValid && !accepting() ? "false" : "true"}')
  })

  it("onReviewAccept called with draft config on Start click", () => {
    expect(SRC).toContain("props.onReviewAccept(draft())")
  })

  it("onReviewAccept rejection surfaces error (setAcceptError)", () => {
    expect(SRC).toContain("acceptError")
    expect(SRC).toContain("setAcceptError")
  })

  it("ESC calls props.onCancel via handleKeyDown", () => {
    expect(SRC).toContain("props.onCancel")
    expect(SRC).toContain('"Escape"')
  })

  it("DOM branch has role=dialog and aria-modal=true", () => {
    expect(SRC).toContain('role="dialog"')
    expect(SRC).toContain('aria-modal="true"')
  })

  it("uses RosterTable with readOnly=true in review step", () => {
    expect(SRC).toContain("RosterTable")
    expect(SRC).toContain("readOnly={true}")
  })

  it("uses StageCoverageIndicator in review step", () => {
    expect(SRC).toContain("StageCoverageIndicator")
    expect(SRC).toContain("validation().missingStages")
  })

  it("uses useTeamValidation for reactive validation", () => {
    expect(SRC).toContain("useTeamValidation")
    expect(SRC).toContain("TeamValidationResult")
  })

  it("step 3 shows done message", () => {
    expect(SRC).toContain("Team saved. Starting workflow...")
  })

  it("no top-level @opentui static import (CONVENTIONS.md §3)", () => {
    const lines = SRC.split("\n")
    const topLevelOpentui = lines.filter(
      (l) => l.includes('from "@opentui') && !l.trim().startsWith("//"),
    )
    expect(topLevelOpentui.length).toBe(0)
  })

  it("has TerminalOnboardingWizard function for terminal branch", () => {
    expect(SRC).toContain("TerminalOnboardingWizard")
  })

  it("has 3-step flow: pick, review, done", () => {
    expect(SRC).toContain('"pick"')
    expect(SRC).toContain('"review"')
    expect(SRC).toContain('"done"')
  })
})
