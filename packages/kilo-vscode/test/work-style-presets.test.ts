import { describe, expect, test } from "bun:test"
import {
  buildWorkStylePlan,
  getDisplayPreset,
  getInitialWorkStyle,
  getWorkStylePreset,
  WORK_STYLE_CHOICES,
} from "../src/shared/work-style-presets"

describe("display presets", () => {
  test("offers the human-in-the-loop and autonomous styles", () => {
    expect(WORK_STYLE_CHOICES).toEqual(["human-in-the-loop", "autonomous"])
  })

  test("human-in-the-loop expands reasoning, commands and edits and shows the approval reason", () => {
    expect(getDisplayPreset("human-in-the-loop")).toEqual({
      reasoning_display: "expanded",
      terminal_command_display: "expanded",
      code_edit_display: "expanded",
      mcp_tool_display: "collapsed",
    })
  })

  test("autonomous previews reasoning, collapses commands and edits and hides the approval reason", () => {
    expect(getDisplayPreset("autonomous")).toEqual({
      reasoning_display: "preview",
      terminal_command_display: "collapsed",
      code_edit_display: "collapsed",
      mcp_tool_display: "collapsed",
    })
  })
})

describe("work style presets", () => {
  test("review first asks before edits, commands and external paths and keeps the safe shell allowlist", () => {
    const preset = getWorkStylePreset("human-in-the-loop")
    expect(preset.settings).toEqual({ showTaskTimeline: true, showAutoApprovalReason: true })
    expect(preset.permissions).toContainEqual({ action: "edit", resource: "*", effect: "ask" })
    expect(preset.permissions).toContainEqual({ action: "shell", resource: "*", effect: "ask" })
    expect(preset.permissions).toContainEqual({ action: "external_directory", resource: "*", effect: "ask" })
    expect(preset.permissions).toContainEqual({ action: "read", resource: "*.env", effect: "ask" })
    expect(preset.permissions).toContainEqual({ action: "read", resource: "*.env.example", effect: "allow" })
    expect(preset.permissions).toContainEqual({ action: "shell", resource: "cat *", effect: "allow" })
    expect(preset.permissions).toContainEqual({ action: "shell", resource: "*>*", effect: "ask" })
    // The safe allowlist must follow the general ask rule and the redirect guard must follow the allowlist.
    const shell = preset.permissions.filter((rule) => rule.action === "shell")
    expect(shell[0]).toEqual({ action: "shell", resource: "*", effect: "ask" })
    expect(shell.at(-1)).toEqual({ action: "shell", resource: "*>*", effect: "ask" })
  })

  test("high autonomy edits and runs commands without asking but still asks outside the workspace", () => {
    const preset = getWorkStylePreset("autonomous")
    expect(preset.settings).toEqual({ showTaskTimeline: true, showAutoApprovalReason: false })
    expect(preset.permissions).toEqual([
      { action: "edit", resource: "*", effect: "allow" },
      { action: "shell", resource: "*", effect: "allow" },
      { action: "external_directory", resource: "*", effect: "ask" },
    ])
  })
})

describe("work style onboarding state", () => {
  test("shows the picker only when the project has no sessions", () => {
    expect(getInitialWorkStyle(false)).toBe("unset")
    expect(getInitialWorkStyle(true)).toBe("skipped")
  })
})

describe("buildWorkStylePlan", () => {
  const noSettings = () => false

  test("fills every unset display and permission value", () => {
    expect(buildWorkStylePlan({ style: "human-in-the-loop", config: {}, settingCustomized: noSettings })).toEqual({
      config: {
        terminal_command_display: "expanded",
        code_edit_display: "expanded",
        mcp_tool_display: "collapsed",
        reasoning_display: "expanded",
        permissions: getWorkStylePreset("human-in-the-loop").permissions,
      },
      settings: { showTaskTimeline: true, showAutoApprovalReason: true },
    })
  })

  test("keeps values the config already defines", () => {
    const plan = buildWorkStylePlan({
      style: "autonomous",
      config: {
        terminal_command_display: "expanded",
        code_edit_display: "collapsed",
        mcp_tool_display: "expanded",
        auto_collapse_reasoning: true,
        permission: { edit: "ask" },
      },
      settingCustomized: noSettings,
    })
    expect(plan.config).toEqual({})
  })

  test("treats empty permission containers as unset", () => {
    expect(
      buildWorkStylePlan({
        style: "autonomous",
        config: { permission: {}, permissions: [] },
        settingCustomized: noSettings,
      }).config.permissions,
    ).toEqual(getWorkStylePreset("autonomous").permissions)
  })

  test("leaves a setting the user customized in VS Code alone", () => {
    const plan = buildWorkStylePlan({
      style: "autonomous",
      config: {},
      settingCustomized: (key) => key === "showAutoApprovalReason",
    })
    expect(plan.settings).toEqual({ showTaskTimeline: true })
  })
})
