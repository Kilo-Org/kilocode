// Work style presets. The onboarding picker applies these once for a new user; the Display settings tab applies
// only the display part. Permission rules use the v2 ordered ruleset, where the last matching rule wins.
export type WorkStyle = "human-in-the-loop" | "autonomous"
export type WorkStyleState = WorkStyle | "skipped" | "unset"

export type PermissionEffect = "allow" | "ask" | "deny"

export type PermissionRule = {
  action: string
  resource: string
  effect: PermissionEffect
}

export type DisplayPreset = {
  reasoning_display: "expanded" | "preview" | "headline"
  terminal_command_display: "expanded" | "collapsed"
  code_edit_display: "expanded" | "collapsed"
  mcp_tool_display: "expanded" | "collapsed"
}

export type WorkStyleSettings = {
  showTaskTimeline: boolean
  showAutoApprovalReason: boolean
}

export type WorkStylePreset = {
  style: WorkStyle
  display: DisplayPreset
  permissions: PermissionRule[]
  settings: WorkStyleSettings
}

const SHELL_ALLOW = [
  "cat *",
  "head *",
  "tail *",
  "less *",
  "ls *",
  "tree *",
  "pwd *",
  "echo *",
  "wc *",
  "which *",
  "type *",
  "file *",
  "diff *",
  "du *",
  "df *",
  "date *",
  "uname *",
  "whoami *",
  "printenv *",
  "man *",
  "grep *",
  "rg *",
  "ag *",
  "uniq *",
  "cut *",
  "tr *",
  "jq *",
]

// Review first asks before edits and commands, with the same read and shell exceptions as v1.
const HUMAN_PERMISSIONS: PermissionRule[] = [
  { action: "read", resource: "*", effect: "allow" },
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
  { action: "edit", resource: "*", effect: "ask" },
  { action: "external_directory", resource: "*", effect: "ask" },
  { action: "shell", resource: "*", effect: "ask" },
  ...SHELL_ALLOW.map((resource): PermissionRule => ({ action: "shell", resource, effect: "allow" })),
  { action: "shell", resource: "*>*", effect: "ask" },
]

// High autonomy edits and runs commands in the workspace without asking, and still asks outside it.
const AUTONOMOUS_PERMISSIONS: PermissionRule[] = [
  { action: "edit", resource: "*", effect: "allow" },
  { action: "shell", resource: "*", effect: "allow" },
  { action: "external_directory", resource: "*", effect: "ask" },
]

export const WORK_STYLE_CHOICES: WorkStyle[] = ["human-in-the-loop", "autonomous"]

function display(style: WorkStyle): DisplayPreset {
  const human = style === "human-in-the-loop"
  return {
    reasoning_display: human ? "expanded" : "preview",
    terminal_command_display: human ? "expanded" : "collapsed",
    code_edit_display: human ? "expanded" : "collapsed",
    mcp_tool_display: "collapsed",
  }
}

export function getDisplayPreset(style: WorkStyle): DisplayPreset {
  return display(style)
}

export function getWorkStylePreset(style: WorkStyle): WorkStylePreset {
  return {
    style,
    display: display(style),
    permissions: style === "human-in-the-loop" ? HUMAN_PERMISSIONS : AUTONOMOUS_PERMISSIONS,
    settings: {
      showTaskTimeline: true,
      showAutoApprovalReason: style === "human-in-the-loop",
    },
  }
}

export function getInitialWorkStyle(hasSessions: boolean): WorkStyleState {
  return hasSessions ? "skipped" : "unset"
}

function hasRules(value: unknown): boolean {
  if (value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === "object") return Object.keys(value).length > 0
  return true
}

/**
 * The config and settings a first-run picker should write. It fills only values the config does not define, so a
 * user's own display or permission settings win, and it leaves a setting the user customized in VS Code alone.
 */
export function buildWorkStylePlan(input: {
  style: WorkStyle
  config: Record<string, unknown>
  settingCustomized: (key: keyof WorkStyleSettings) => boolean
}): { config: Record<string, unknown>; settings: Partial<WorkStyleSettings> } {
  const preset = getWorkStylePreset(input.style)
  const config: Record<string, unknown> = {}
  if (input.config.terminal_command_display === undefined) {
    config.terminal_command_display = preset.display.terminal_command_display
  }
  if (input.config.code_edit_display === undefined) {
    config.code_edit_display = preset.display.code_edit_display
  }
  if (input.config.mcp_tool_display === undefined) {
    config.mcp_tool_display = preset.display.mcp_tool_display
  }
  if (input.config.reasoning_display === undefined && input.config.auto_collapse_reasoning === undefined) {
    config.reasoning_display = preset.display.reasoning_display
  }
  if (
    !hasRules(input.config.permissions) &&
    !hasRules(input.config.permission) &&
    !hasRules(input.config.tools)
  ) {
    config.permissions = preset.permissions
  }
  const settings: Partial<WorkStyleSettings> = {}
  if (!input.settingCustomized("showTaskTimeline")) settings.showTaskTimeline = preset.settings.showTaskTimeline
  if (!input.settingCustomized("showAutoApprovalReason")) {
    settings.showAutoApprovalReason = preset.settings.showAutoApprovalReason
  }
  return { config, settings }
}
