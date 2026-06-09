type PermissionLevel = "allow" | "ask" | "deny"
type PermissionRule = PermissionLevel | null | Record<string, PermissionLevel | null>
type PermissionConfig = Partial<Record<string, PermissionRule>>

export interface WorkStyleConfig {
  permission?: PermissionConfig
  terminal_command_display?: "expanded" | "collapsed"
  auto_collapse_reasoning?: boolean
}

export type WorkStyle = "human" | "autonomous"
export type WorkStyleState = WorkStyle | "custom" | "skipped" | "unset"

export interface WorkStyleChange {
  label: string
  value: string
}

export interface WorkStyleChoice {
  id: WorkStyle
  title: string
  eyebrow: string
  description: string
  changes: WorkStyleChange[]
}

export interface WorkStyleSettings {
  showTaskTimeline: boolean
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
  "sort *": "allow",
  "uniq *": "allow",
  "cut *": "allow",
  "tr *": "allow",
  "jq *": "allow",
  "touch *": "allow",
  "mkdir *": "allow",
  "cp *": "allow",
  "mv *": "allow",
  "tsc *": "allow",
  "tsgo *": "allow",
  "tar *": "allow",
  "unzip *": "allow",
  "gzip *": "allow",
  "gunzip *": "allow",
}

export const WORK_STYLE_CHOICES: WorkStyleChoice[] = [
  {
    id: "human",
    title: "Review-first",
    eyebrow: "Human in the Loop",
    description: "Kilo pauses more often and keeps its work visible while it runs.",
    changes: [
      { label: "Permissions", value: "Ask before edits and most actions. Reads and searches stay allowed." },
      { label: "Bash", value: "Allow known safe commands, ask for everything else." },
      { label: "Visibility", value: "Open reasoning, terminal output, and the context timeline by default." },
    ],
  },
  {
    id: "autonomous",
    title: "High autonomy",
    eyebrow: "Fewer interruptions",
    description: "Kilo keeps the UI out of the way without loosening approval rules.",
    changes: [
      { label: "Permissions", value: "Leave approval rules unchanged. Use Auto-approve to auto-accept prompts." },
      { label: "Bash", value: "No new bash allow rules are added by this preset." },
      { label: "Visibility", value: "Collapse reasoning, terminal output, and the context timeline by default." },
    ],
  },
]

export const WORK_STYLE_PRESETS: Record<WorkStyle, WorkStylePreset> = {
  human: {
    style: "human",
    config: {
      terminal_command_display: "expanded",
      auto_collapse_reasoning: false,
      permission: {
        "*": "ask",
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
      showTaskTimeline: true,
    },
  },
  autonomous: {
    style: "autonomous",
    config: {
      terminal_command_display: "collapsed",
      auto_collapse_reasoning: true,
    },
    settings: {
      showTaskTimeline: false,
    },
  },
}

export function getWorkStylePreset(style: WorkStyle): WorkStylePreset {
  return WORK_STYLE_PRESETS[style]
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
  force?: boolean
}): WorkStyleApplyPlan {
  const preset = getWorkStylePreset(input.style)
  const force = input.force === true
  const next: WorkStyleConfig = {}

  if (preset.config.permission && (force || !hasPermissionConfig(input.config))) {
    next.permission = stripPermission(preset.config.permission)
  }
  if (force || input.config.terminal_command_display === undefined) {
    next.terminal_command_display = preset.config.terminal_command_display
  }
  if (force || input.config.auto_collapse_reasoning === undefined) {
    next.auto_collapse_reasoning = preset.config.auto_collapse_reasoning
  }

  const settingDefault = input.settingDefault ?? (() => true)
  return {
    config: next,
    settings: {
      ...(force || settingDefault("showTaskTimeline") ? { showTaskTimeline: preset.settings.showTaskTimeline } : {}),
    },
  }
}
