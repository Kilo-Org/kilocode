import { describe, expect, it } from "bun:test"
import {
  buildWorkStyleApplyPlan,
  getDisplayPreset,
  getInitialWorkStyle,
  WORK_STYLE_PRESETS,
} from "../../src/shared/work-style-presets"

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
    expect(cfg.reasoning_display).toBe("expanded")
    expect(cfg.permission?.["*"]).toBeUndefined()
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
      showAutoApprovalReason: true,
    })
  })

  it("does not loosen permissions for high autonomy", () => {
    const cfg = WORK_STYLE_PRESETS.autonomous.config
    expect(cfg.terminal_command_display).toBe("collapsed")
    expect(cfg.reasoning_display).toBe("preview")
    expect(cfg.permission).toBeUndefined()
    expect(WORK_STYLE_PRESETS.autonomous.settings).toEqual({
      showTaskTimeline: true,
      showAutoApprovalReason: false,
    })
  })

  it("never defines a top-level permission choice in onboarding presets", () => {
    for (const preset of Object.values(WORK_STYLE_PRESETS)) {
      expect(["ask", "allow", "deny"]).not.toContain(preset.config.permission?.["*"])
    }
  })

  it("does not overwrite existing new-user settings", () => {
    const plan = buildWorkStyleApplyPlan({
      style: "human-in-the-loop",
      config: {
        permission: { edit: "allow" },
        terminal_command_display: "collapsed",
        reasoning_display: "headline",
        code_edit_display: "collapsed",
        mcp_tool_display: "expanded",
      },
      settingDefault: () => false,
    })
    expect(plan).toEqual({ config: {}, settings: {} })
  })

  it.each([false, true])("respects legacy auto_collapse_reasoning=%s", (legacy) => {
    const plan = buildWorkStyleApplyPlan({
      style: "autonomous",
      config: { auto_collapse_reasoning: legacy },
      settingDefault: () => false,
    })
    expect(plan.config.reasoning_display).toBeUndefined()
  })

  it.each(["human-in-the-loop", "autonomous"] as const)("limits the %s display preset to display fields", (style) => {
    const human = style === "human-in-the-loop"
    const preset = getDisplayPreset(style)
    expect(preset).toEqual({
      config: {
        reasoning_display: human ? "expanded" : "preview",
        terminal_command_display: human ? "expanded" : "collapsed",
        code_edit_display: human ? "expanded" : "collapsed",
        mcp_tool_display: "collapsed",
      },
      settings: { showAutoApprovalReason: human },
    })
    const plan = buildWorkStyleApplyPlan({ style, config: {} })
    expect(plan).toEqual({
      config: { ...preset.config, ...(human ? { permission: WORK_STYLE_PRESETS[style].config.permission } : {}) },
      settings: { ...preset.settings, showTaskTimeline: true },
    })
  })

  it("only fills unset config fields and default extension settings", () => {
    const plan = buildWorkStyleApplyPlan({
      style: "autonomous",
      config: { code_edit_display: "expanded", mcp_tool_display: "expanded" },
      settingDefault: (key) => key === "showAutoApprovalReason",
    })
    expect(plan).toEqual({
      config: { terminal_command_display: "collapsed", reasoning_display: "preview" },
      settings: { showAutoApprovalReason: false },
    })
  })
})
