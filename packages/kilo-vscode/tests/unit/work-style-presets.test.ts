import { describe, expect, it } from "bun:test"
import { buildWorkStyleApplyPlan, WORK_STYLE_PRESETS } from "../../src/shared/work-style-presets"

describe("work style presets", () => {
  it("uses ask-first permissions for human in the loop", () => {
    const cfg = WORK_STYLE_PRESETS.human.config
    expect(cfg.terminal_command_display).toBe("expanded")
    expect(cfg.auto_collapse_reasoning).toBe(false)
    expect(cfg.permission?.["*"]).toBe("ask")
    expect(cfg.permission?.edit).toBe("ask")
    expect(cfg.permission?.bash).toMatchObject({ "*": "ask", "rg *": "allow" })
    expect("git diff *" in (cfg.permission?.bash as Record<string, string>)).toBe(false)
    expect(WORK_STYLE_PRESETS.human.settings).toEqual({
      showTaskTimeline: true,
    })
  })

  it("does not loosen permissions for high autonomy", () => {
    const cfg = WORK_STYLE_PRESETS.autonomous.config
    expect(cfg.terminal_command_display).toBe("collapsed")
    expect(cfg.auto_collapse_reasoning).toBe(true)
    expect(cfg.permission).toBeUndefined()
    expect(WORK_STYLE_PRESETS.autonomous.settings).toEqual({
      showTaskTimeline: false,
    })
  })

  it("does not overwrite existing new-user settings unless forced", () => {
    const plan = buildWorkStyleApplyPlan({
      style: "human",
      config: { permission: { edit: "allow" }, terminal_command_display: "collapsed", auto_collapse_reasoning: true },
      settingDefault: () => false,
    })
    expect(plan).toEqual({ config: {}, settings: {} })
  })

  it("overwrites existing settings when applied from settings", () => {
    const plan = buildWorkStyleApplyPlan({
      style: "autonomous",
      config: { permission: { edit: "ask" }, terminal_command_display: "expanded" },
      settingDefault: () => false,
      force: true,
    })
    expect(plan.config.terminal_command_display).toBe("collapsed")
    expect(plan.config.auto_collapse_reasoning).toBe(true)
    expect(plan.config.permission).toBeUndefined()
    expect(plan.settings).toEqual({ showTaskTimeline: false })
  })
})
