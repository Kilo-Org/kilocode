import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

// NOTE: Structural assertions only — no opentui runtime.
// Config.get/update behavior tested via source structure inspection.

const WF_TUI = join(import.meta.dir, "../../../src/devilcode/workflow-tui")
const contextSrc = readFileSync(join(WF_TUI, "context.tsx"), "utf8")
const commandSrc = readFileSync(join(WF_TUI, "command-input.tsx"), "utf8")
const indexSrc = readFileSync(join(WF_TUI, "index.tsx"), "utf8")

describe("density.integration — context.tsx density state", () => {
  it("store has density field defaulting to 'expanded'", () => {
    expect(contextSrc).toContain('"expanded" as DensityMode')
  })

  it("store has firstRunComplete field defaulting to false", () => {
    expect(contextSrc).toContain("firstRunComplete: false")
  })

  it("WorkflowViewState type declares density: DensityMode", () => {
    expect(contextSrc).toContain("density: DensityMode")
  })

  it("WorkflowViewState type declares firstRunComplete: boolean", () => {
    // Check type block has firstRunComplete
    const typeBlock = contextSrc.match(/export type WorkflowViewState = \{[\s\S]*?\}/)?.[0] ?? ""
    expect(typeBlock).toContain("firstRunComplete")
  })

  it("WorkflowViewState type declares setDensity action", () => {
    expect(contextSrc).toContain("setDensity(mode: DensityMode): Promise<void>")
  })

  it("WorkflowViewState type declares markFirstRunComplete action", () => {
    expect(contextSrc).toContain("markFirstRunComplete(): Promise<void>")
  })

  it("handleSetDensity uses Config.get + Config.update read-then-merge (R3-02)", () => {
    expect(contextSrc).toContain("handleSetDensity")
    // Must include: const current = await Config.get()
    expect(contextSrc).toContain("await Config.get()")
    // Must include: await Config.update({...current, workflow: {...}})
    expect(contextSrc).toContain("Config.update(")
    expect(contextSrc).toContain("workflow:")
    expect(contextSrc).toContain("density: mode")
  })

  it("handleMarkFirstRunComplete uses Config.get + Config.update", () => {
    expect(contextSrc).toContain("handleMarkFirstRunComplete")
    expect(contextSrc).toContain("firstRunComplete: true")
  })

  it("onMount seeds density from Config.get().workflow?.density", () => {
    expect(contextSrc).toContain("cfg.workflow?.density")
    expect(contextSrc).toContain('"expanded"')  // default fallback
  })

  it("onMount seeds firstRunComplete from Config.get().workflow?.firstRunComplete", () => {
    expect(contextSrc).toContain("cfg.workflow?.firstRunComplete")
  })

  it("onMount seeds autoCompactFired from Config (R3-05 — prevents re-fire)", () => {
    expect(contextSrc).toContain("autoCompactFired")
    expect(contextSrc).toContain("cfg.workflow?.autoCompactFired")
  })
})

describe("density.integration — auto-compact effect", () => {
  it("createEffect registered for auto-compact logic", () => {
    expect(contextSrc).toContain("createEffect(")
    expect(contextSrc).toContain("autoCompactFired")
  })

  it("auto-compact guards: autoCompactFired, firstRunComplete, density, any completed task", () => {
    expect(contextSrc).toContain("if (autoCompactFired) return")
    expect(contextSrc).toContain("if (!store.firstRunComplete) return")
    expect(contextSrc).toContain('if (store.density !== "expanded") return')
    expect(contextSrc).toContain('status === "completed"')
  })

  it("auto-compact fires handleSetDensity('compact') and sets autoCompactFired=true", () => {
    expect(contextSrc).toContain("autoCompactFired = true")
    expect(contextSrc).toContain('void handleSetDensity("compact")')
  })

  it("auto-compact persists autoCompactFired flag to Config (R3-05)", () => {
    // Should update config with autoCompactFired: true
    expect(contextSrc).toContain("autoCompactFired: true")
  })

  it("named handler functions declared BEFORE createEffect (R3-06 — no TDZ)", () => {
    const handlerPos = contextSrc.indexOf("async function handleSetDensity")
    const effectPos = contextSrc.indexOf("let autoCompactFired")
    expect(handlerPos).toBeGreaterThan(0)
    expect(effectPos).toBeGreaterThan(handlerPos)
  })
})

describe("density.integration — /density command", () => {
  it("command-input handles 'density compact' to call wf.setDensity", () => {
    expect(commandSrc).toContain("density")
    expect(commandSrc).toContain("setDensity(mode)")
    expect(commandSrc).toContain('"compact"')
    expect(commandSrc).toContain('"expanded"')
  })

  it("command-input rejects invalid density arg with warning toast", () => {
    expect(commandSrc).toContain("Usage: density compact|expanded")
  })

  it("DensityProvider wraps the tree in WorkflowView (index.tsx)", () => {
    expect(indexSrc).toContain("DensityProvider")
    expect(indexSrc).toContain("onPersist=")
    expect(indexSrc).toContain("wf.setDensity")
  })

  it("DensityProvider initial seeded from wf.density (reads store)", () => {
    expect(indexSrc).toContain("initial={wf.density}")
  })
})
