import { describe, it, expect } from "bun:test"
import { readFileSync, existsSync } from "fs"
import { join } from "path"

// NOTE: Cannot runtime-import TUI modules in Bun test (opentui/solid TTY deps).
// All assertions are structural — source file analysis (same pattern as index.smoke.test.ts).

const WF_TUI = join(import.meta.dir, "../../../src/devilcode/workflow-tui")

const cockpitSrc = readFileSync(join(WF_TUI, "runtime-cockpit.tsx"), "utf8")
const indexSrc = readFileSync(join(WF_TUI, "index.tsx"), "utf8")
const contextSrc = readFileSync(join(WF_TUI, "context.tsx"), "utf8")
const commandSrc = readFileSync(join(WF_TUI, "command-input.tsx"), "utf8")
const helpersSrc = readFileSync(join(WF_TUI, "tabs/helpers.ts"), "utf8")

describe("cockpit.integration — runtime-cockpit composition", () => {
  it("runtime-cockpit.tsx exists", () => {
    expect(existsSync(join(WF_TUI, "runtime-cockpit.tsx"))).toBe(true)
  })

  it("status-bar.tsx is deleted", () => {
    expect(existsSync(join(WF_TUI, "status-bar.tsx"))).toBe(false)
  })

  it("detail-panel.tsx is deleted", () => {
    expect(existsSync(join(WF_TUI, "detail-panel.tsx"))).toBe(false)
  })

  it("tabs/tab-bar.tsx is deleted", () => {
    expect(existsSync(join(WF_TUI, "tabs/tab-bar.tsx"))).toBe(false)
  })

  it("tabs/helpers.ts exists with hint() function", () => {
    expect(existsSync(join(WF_TUI, "tabs/helpers.ts"))).toBe(true)
    expect(helpersSrc).toContain("export function hint(")
  })

  it("RuntimeCockpit exported from runtime-cockpit.tsx", () => {
    expect(cockpitSrc).toContain("export function RuntimeCockpit(")
  })

  it("RuntimeCockpit uses StagePositionBadge", () => {
    expect(cockpitSrc).toContain("StagePositionBadge")
    expect(cockpitSrc).toContain("stage-position-badge")
  })

  it("RuntimeCockpit uses DetailPanel primitive (not old detail-panel.tsx)", () => {
    expect(cockpitSrc).toContain("DetailPanel")
    expect(cockpitSrc).toContain("primitives/detail-panel")
  })

  it("RuntimeCockpit uses TabGroup with render-prop pattern (not TabSlot)", () => {
    expect(cockpitSrc).toContain("TabGroup")
    expect(cockpitSrc).toContain("primitives/tab-group")
    // Render-prop: children function receives tab and switches on kind
    expect(cockpitSrc).toContain("info?.kind")
    expect(cockpitSrc).not.toContain("TabSlot")
  })

  it("RuntimeCockpit imports all 5 tab components", () => {
    expect(cockpitSrc).toContain("PlanTab")
    expect(cockpitSrc).toContain("ActivityTab")
    expect(cockpitSrc).toContain("ChallengeTab")
    expect(cockpitSrc).toContain("ReviewTab")
    expect(cockpitSrc).toContain("AgentOutputTab")
  })

  it("RuntimeCockpit uses useStagePosition hook", () => {
    expect(cockpitSrc).toContain("useStagePosition")
    expect(cockpitSrc).toContain("hooks/use-stage-position")
  })

  it("RuntimeCockpit uses useDensityOptional (safe — no DensityProvider required)", () => {
    expect(cockpitSrc).toContain("useDensityOptional")
    expect(cockpitSrc).toContain("hooks/use-density")
    // Must NOT use useDensity (throws outside provider)
    expect(cockpitSrc).not.toMatch(/\buseDensity\(\)/)
  })

  it("RuntimeCockpit includes WorkflowCommandInput", () => {
    expect(cockpitSrc).toContain("WorkflowCommandInput")
  })

  it("index.tsx 3-mode router — all 3 modes declared", () => {
    expect(indexSrc).toContain('"onboarding"')
    expect(indexSrc).toContain('"workflow"')
    expect(indexSrc).toContain('"team-builder"')
    expect(indexSrc).toContain("CockpitMode")
  })

  it("index.tsx renders DensityProvider wrapping the tree", () => {
    expect(indexSrc).toContain("DensityProvider")
    expect(indexSrc).toContain("@devilcode/kilo-ui/context/density")
  })

  it("index.tsx renders OnboardingWizard in onboarding branch", () => {
    expect(indexSrc).toContain("OnboardingWizard")
    expect(indexSrc).toContain("@devilcode/kilo-ui/primitives/onboarding-wizard")
  })

  it("index.tsx renders RuntimeCockpit in workflow branch", () => {
    expect(indexSrc).toContain("RuntimeCockpit")
    expect(indexSrc).toContain("./runtime-cockpit")
  })

  it("index.tsx checks firstRunComplete on mount to set initial mode", () => {
    expect(indexSrc).toContain("firstRunComplete")
    expect(indexSrc).toContain("onboarding")
  })

  it("context.tsx has density and firstRunComplete state fields", () => {
    expect(contextSrc).toContain("density: DensityMode")
    expect(contextSrc).toContain("firstRunComplete")
  })

  it("context.tsx has setDensity and markFirstRunComplete actions", () => {
    expect(contextSrc).toContain("setDensity")
    expect(contextSrc).toContain("markFirstRunComplete")
  })

  it("command-input.tsx registers /density command", () => {
    expect(commandSrc).toContain("density")
    expect(commandSrc).toContain("compact")
    expect(commandSrc).toContain("expanded")
  })

  it("All 8 original commands still present in command-input.tsx", () => {
    // back, status, pause, approve, revise, next, task, plus stage dispatch
    expect(commandSrc).toContain('"back"')
    expect(commandSrc).toContain('"status"')
    expect(commandSrc).toContain('"pause"')
    expect(commandSrc).toContain('"approve"')
    expect(commandSrc).toContain('"revise"')
    expect(commandSrc).toContain('"next"')
    expect(commandSrc).toContain('"task "')
    // Stage dispatch for plan/challenge/build/review/ship/retro
    expect(commandSrc).toContain("WorkflowStage.safeParse")
  })

  it("hint() helper in tabs/helpers.ts covers all 7 workflow stages", () => {
    const stages = ["plan", "challenge", "contract", "build", "review", "ship", "retro"]
    for (const stage of stages) {
      expect(helpersSrc).toContain(`case "${stage}":`)
    }
  })

  it("hint() handles null state (workflow not initialized)", () => {
    expect(helpersSrc).toContain("Workflow Setup")
  })
})
