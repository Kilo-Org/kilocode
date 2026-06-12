import { describe, expect, it } from "bun:test"
import { buildWorkStyleApplyPlan, getInitialWorkStyle, WORK_STYLE_PRESETS } from "../../src/shared/work-style-presets"

describe("work style presets", () => {
  it("shows onboarding for users without sessions", () => {
    expect(getInitialWorkStyle(false)).toBe("unset")
  })

  it("skips onboarding for users with existing sessions", () => {
    expect(getInitialWorkStyle(true)).toBe("skipped")
  })

  it("uses ask-first permissions for human in the loop", () => {
    const cfg = WORK_STYLE_PRESETS["human-in-the-loop"].config
    const bash = cfg.permission?.bash as Record<string, string>
    expect(cfg.terminal_command_display).toBe("expanded")
    expect(cfg.auto_collapse_reasoning).toBe(false)
    expect(cfg.permission?.["*"]).toBe("ask")
    expect(cfg.permission?.edit).toBe("ask")
    expect(bash).toMatchObject({ "*": "ask", "rg *": "allow", "*>*": "ask" })
    expect(Object.keys(bash).at(-1)).toBe("*>*")
    for (const command of [
      "touch *",
      "mkdir *",
      "cp *",
      "mv *",
      "sort *",
      "tsc *",
      "tsgo *",
      "tar *",
      "unzip *",
      "gzip *",
      "gunzip *",
    ]) {
      expect(command in bash).toBe(false)
    }
    expect("git diff *" in bash).toBe(false)
    expect(WORK_STYLE_PRESETS["human-in-the-loop"].settings).toEqual({
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

  it("does not overwrite existing new-user settings", () => {
    const plan = buildWorkStyleApplyPlan({
      style: "human-in-the-loop",
      config: { permission: { edit: "allow" }, terminal_command_display: "collapsed", auto_collapse_reasoning: true },
      settingDefault: () => false,
    })
    expect(plan).toEqual({ config: {}, settings: {} })
  })
})
