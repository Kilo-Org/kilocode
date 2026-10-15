type PermissionLevel = "allow" | "ask" | "deny"
type PermissionRule = PermissionLevel | null | Record<string, PermissionLevel | null>
type PermissionConfig = Partial<Record<string, PermissionRule>>

export interface WorkStyleConfig {
  permission?: PermissionConfig
  terminal_command_display?: "expanded" | "collapsed"
  code_edit_display?: "expanded" | "collapsed"
  mcp_tool_display?: "expanded" | "collapsed"
  reasoning_display?: "expanded" | "preview" | "headline"
  auto_collapse_reasoning?: boolean
}

export type WorkStyle = "human-in-the-loop" | "autonomous"
export type WorkStyleState = WorkStyle | "skipped" | "unset"

export interface WorkStyleSettings {
  showTaskTimeline: boolean
  showAutoApprovalReason: boolean
}

export interface WorkStylePreset {
  style: WorkStyle
  config: WorkStyleConfig
  settings: WorkStyleSettings
}

export interface WorkStyleApplyPlan {
  config: WorkStyleConfig
  settings: Partial<WorkStyleSettings>
}

const BASH: Record<string, PermissionLevel> = {
  "*": "ask",
  "cat *": "allow",
  "head *": "allow",
  "tail *": "allow",
  "less *": "allow",
  "ls *": "allow",
  "tree *": "allow",
  "pwd *": "allow",
  "echo *": "allow",
  "wc *": "allow",
  "which *": "allow",
  "type *": "allow",
  "file *": "allow",
  "diff *": "allow",
  "du *": "allow",
  "df *": "allow",
  "date *": "allow",
  "uname *": "allow",
  "whoami *": "allow",
  "printenv *": "allow",
  "man *": "allow",
  "grep *": "allow",
  "rg *": "allow",
  "ag *": "allow",
  "uniq *": "allow",
  "cut *": "allow",
  "tr *": "allow",
  "jq *": "allow",
  "*>*": "ask",
}

export const WORK_STYLE_CHOICES: WorkStyle[] = ["human-in-the-loop", "autonomous"]

export function getDisplayPreset(style: WorkStyle) {
  const human = style === "human-in-the-loop"
  return {
    config: {
      reasoning_display: human ? "expanded" : "preview",
      terminal_command_display: human ? "expanded" : "collapsed",
      code_edit_display: human ? "expanded" : "collapsed",
      mcp_tool_display: "collapsed",
    },
    settings: { showAutoApprovalReason: human },
  } as const
}

export const WORK_STYLE_PRESETS: Record<WorkStyle, WorkStylePreset> = {
  "human-in-the-loop": {
    style: "human-in-the-loop",
    config: {
      ...getDisplayPreset("human-in-the-loop").config,
      permission: {
        read: {
          "*": "allow",
          "*.env": "ask",
          "*.env.*": "ask",
          "*.env.example": "allow",
        },
        grep: "allow",
        glob: "allow",
        list: "allow",
        question: "allow",
        webfetch: "allow",
        websearch: "allow",
        codesearch: "allow",
        external_directory: "ask",
        edit: "ask",
        bash: BASH,
        doom_loop: "ask",
      },
    },
    settings: {
      ...getDisplayPreset("human-in-the-loop").settings,
      showTaskTimeline: true,
    },
  },
  autonomous: {
    style: "autonomous",
    config: {
      ...getDisplayPreset("autonomous").config,
    },
    settings: {
      ...getDisplayPreset("autonomous").settings,
      showTaskTimeline: true,
    },
  },
}

export function getWorkStylePreset(style: WorkStyle): WorkStylePreset {
  return WORK_STYLE_PRESETS[style]
}

export function getInitialWorkStyle(hasSessions: boolean): WorkStyleState {
  return hasSessions ? "skipped" : "unset"
}

export function hasPermissionConfig(config: WorkStyleConfig): boolean {
  return Object.keys(config.permission ?? {}).length > 0
}

function stripPermission(config: PermissionConfig): PermissionConfig {
  const result: PermissionConfig = {}
  for (const [key, rule] of Object.entries(config)) {
    if (rule === null || rule === undefined) continue
    if (typeof rule === "string") {
      result[key] = rule
      continue
    }
    const next: Record<string, PermissionLevel | null> = {}
    for (const [pattern, action] of Object.entries(rule)) {
      if (action !== null && action !== undefined) next[pattern] = action
    }
    if (Object.keys(next).length > 0) result[key] = next as PermissionRule
  }
  return result
}

export function buildWorkStyleApplyPlan(input: {
  style: WorkStyle
  config: WorkStyleConfig
  settingDefault?: (key: keyof WorkStyleSettings) => boolean
}): WorkStyleApplyPlan {
  const preset = getWorkStylePreset(input.style)
  const next: WorkStyleConfig = {}

  if (preset.config.permission && !hasPermissionConfig(input.config)) {
    next.permission = stripPermission(preset.config.permission)
  }
  if (input.config.terminal_command_display === undefined) {
    next.terminal_command_display = preset.config.terminal_command_display
  }
  if (input.config.code_edit_display === undefined) {
    next.code_edit_display = preset.config.code_edit_display
  }
  if (input.config.mcp_tool_display === undefined) {
    next.mcp_tool_display = preset.config.mcp_tool_display
  }
  if (input.config.reasoning_display === undefined && input.config.auto_collapse_reasoning === undefined) {
    next.reasoning_display = preset.config.reasoning_display
  }

  const settingDefault = input.settingDefault ?? (() => true)
  return {
    config: next,
    settings: {
      ...(settingDefault("showTaskTimeline") ? { showTaskTimeline: preset.settings.showTaskTimeline } : {}),
      ...(settingDefault("showAutoApprovalReason")
        ? { showAutoApprovalReason: preset.settings.showAutoApprovalReason }
        : {}),
    },
  }
}
