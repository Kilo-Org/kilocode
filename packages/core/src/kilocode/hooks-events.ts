// Hook event registry: plain data with no imports, so the CLI, the config schema, the VS Code
// webview tests and the cloud config schema mirror can all read it.

/** What a hook matcher is tested against for an event. */
export type Matcher =
  | "tool"
  | "source"
  | "reason"
  | "trigger"
  | "agent"
  | "notification"
  | "model"
  | "config"
  | "file"
  | "error"
  | "load"
  | "command"
  | "status"
  | "kind"
  | "origin"

export type Group = "tools" | "prompt" | "session" | "loop" | "compaction" | "environment" | "kilo"

export interface Meta {
  /** One line used by the config schema, the cloud schema mirror and the docs. */
  readonly description: string
  /** A Kilo-only event name (never read from Claude Code settings). */
  readonly kilo: boolean
  /** Imported from ~/.claude/settings.json when Claude Code compatibility is on. */
  readonly claude: boolean
  readonly group: Group
  /** Absent: the event has no matcher and the field is ignored, as in Claude Code. */
  readonly matcher?: Matcher
  /** Exact-match matchers may only use letters, digits, "_" and "|" (anything else is a regular expression). */
  readonly strict?: true
  /** Default timeout of a command hook, in seconds. */
  readonly timeout: number
  /** What exit code 2 does: block the action, give stderr to the model, show stderr to the user, or nothing. */
  readonly exit2: "block" | "feedback" | "user" | "ignore"
  /** Where context goes: nowhere, JSON additionalContext only, or JSON additionalContext and plain exit-0 stdout. */
  readonly context: "none" | "json" | "stdout"
  /** `onFailure: "block"` is honored. */
  readonly failure: boolean
  /** Exit 2 with empty stdout and a "No such file or directory" stderr is a non-blocking failure (a moved script). */
  readonly missing?: true
}

export const EVENTS = {
  PreToolUse: {
    description: "Before a tool call. Exit 2 or a JSON deny blocks the call; ask forces a confirmation prompt.",
    kilo: false,
    claude: true,
    group: "tools",
    matcher: "tool",
    timeout: 600,
    exit2: "block",
    context: "json",
    failure: true,
  },
  PostToolUse: {
    description:
      "After a tool call succeeds. Exit 2 stderr, a block reason or additionalContext is shown to the model; updatedToolOutput replaces the output.",
    kilo: false,
    claude: true,
    group: "tools",
    matcher: "tool",
    timeout: 600,
    exit2: "feedback",
    context: "json",
    failure: false,
  },
  PostToolUseFailure: {
    description:
      "After a tool call fails (including a shell command that exits non-zero). additionalContext is shown to the model.",
    kilo: false,
    claude: true,
    group: "tools",
    matcher: "tool",
    timeout: 600,
    exit2: "feedback",
    context: "json",
    failure: false,
  },
  PostToolBatch: {
    description: "After a model step that ran tools, before the next model call. A block stops the turn.",
    kilo: false,
    claude: true,
    group: "tools",
    timeout: 600,
    exit2: "block",
    context: "json",
    failure: true,
  },
  PermissionRequest: {
    description:
      "When Kilo shows a permission prompt for a tool call. A JSON deny denies the call; hooks cannot approve.",
    kilo: false,
    claude: true,
    group: "tools",
    matcher: "tool",
    timeout: 600,
    exit2: "ignore",
    context: "none",
    failure: true,
  },
  TaskCreated: {
    description: "When a todo is added. A block rolls back that todo.",
    kilo: false,
    claude: true,
    group: "tools",
    timeout: 600,
    exit2: "block",
    context: "none",
    failure: true,
  },
  TaskCompleted: {
    description: "When a todo is marked completed. A block keeps that todo open.",
    kilo: false,
    claude: true,
    group: "tools",
    timeout: 600,
    exit2: "block",
    context: "none",
    failure: false,
    missing: true,
  },
  UserPromptSubmit: {
    description:
      "When a prompt or command is submitted. A block rejects it; stdout or additionalContext is added to the prompt.",
    kilo: false,
    claude: true,
    group: "prompt",
    timeout: 30,
    exit2: "block",
    context: "stdout",
    failure: true,
  },
  UserPromptExpansion: {
    description: "When a custom command, skill or MCP prompt expands. Matcher: command name.",
    kilo: false,
    claude: true,
    group: "prompt",
    matcher: "command",
    timeout: 600,
    exit2: "block",
    context: "stdout",
    failure: true,
  },
  PreModelSwitch: {
    description:
      "Before a prompt switches the session to another model. A block, ask or timeout rejects the prompt. Matcher: model name.",
    kilo: false,
    claude: true,
    group: "prompt",
    matcher: "model",
    timeout: 30,
    exit2: "block",
    context: "none",
    failure: true,
  },
  PostModelSwitch: {
    description: "After the session model changed. stdout or additionalContext is added to the next request.",
    kilo: false,
    claude: true,
    group: "prompt",
    matcher: "model",
    timeout: 30,
    exit2: "user",
    context: "stdout",
    failure: false,
  },
  SessionStart: {
    description:
      "When a session starts, resumes, forks or is compacted. Matcher: startup, resume, fork, compact. stdout or additionalContext is added to the conversation.",
    kilo: false,
    claude: true,
    group: "session",
    matcher: "source",
    timeout: 600,
    exit2: "user",
    context: "stdout",
    failure: false,
  },
  SessionEnd: {
    description: "When a session is deleted or Kilo exits. Matcher: other, prompt_input_exit.",
    kilo: false,
    claude: true,
    group: "session",
    matcher: "reason",
    // Every SessionEnd hook of one exit shares this budget (raised to the largest configured timeout, max 60 s).
    timeout: 1.5,
    exit2: "user",
    context: "none",
    failure: false,
  },
  InstructionsLoaded: {
    description:
      "When an instruction file (AGENTS.md, CLAUDE.md) is loaded. Matcher: session_start, nested_traversal, compact.",
    kilo: false,
    claude: true,
    group: "session",
    matcher: "load",
    timeout: 600,
    exit2: "ignore",
    context: "none",
    failure: false,
  },
  Stop: {
    description: "When the agent finishes responding. A block makes it continue (at most 8 times in a row).",
    kilo: false,
    claude: true,
    group: "loop",
    timeout: 600,
    exit2: "block",
    context: "json",
    failure: false,
    missing: true,
  },
  SubagentStop: {
    description: "When a subagent finishes. A block makes it continue. Matcher: agent type.",
    kilo: false,
    claude: true,
    group: "loop",
    matcher: "agent",
    timeout: 600,
    exit2: "block",
    context: "json",
    failure: false,
    missing: true,
  },
  SubagentStart: {
    description: "When a subagent starts. additionalContext is added to its first prompt. Matcher: agent type.",
    kilo: false,
    claude: true,
    group: "loop",
    matcher: "agent",
    timeout: 600,
    exit2: "user",
    context: "json",
    failure: false,
  },
  StopFailure: {
    description: "When a turn ends with an API error. Matcher: error type.",
    kilo: false,
    claude: true,
    group: "loop",
    matcher: "error",
    strict: true,
    timeout: 600,
    exit2: "ignore",
    context: "none",
    failure: false,
  },
  PreCompact: {
    description: "Before compaction. A block skips it. Matcher: manual, auto.",
    kilo: false,
    claude: true,
    group: "compaction",
    matcher: "trigger",
    timeout: 600,
    exit2: "block",
    context: "none",
    failure: true,
  },
  PostCompact: {
    description: "After compaction. Matcher: manual, auto.",
    kilo: false,
    claude: true,
    group: "compaction",
    matcher: "trigger",
    timeout: 600,
    exit2: "user",
    context: "none",
    failure: false,
  },
  Notification: {
    description: "When Kilo is waiting for you. Matcher: permission_prompt, agent_needs_input, idle_prompt.",
    kilo: false,
    claude: true,
    group: "environment",
    matcher: "notification",
    timeout: 600,
    exit2: "ignore",
    context: "none",
    failure: false,
  },
  ConfigChange: {
    description:
      "After Kilo changes its config. Matcher: user_settings, project_settings. Cannot block; not read from Claude Code settings.",
    kilo: false,
    claude: false,
    group: "environment",
    matcher: "config",
    timeout: 600,
    exit2: "ignore",
    context: "none",
    failure: false,
  },
  FileChanged: {
    description: "When a watched file changes. Matcher: file names to watch, separated by |.",
    kilo: false,
    claude: true,
    group: "environment",
    matcher: "file",
    strict: true,
    timeout: 600,
    exit2: "user",
    context: "none",
    failure: false,
  },
  CwdChanged: {
    description: "When a shell command runs in a different directory than the previous one.",
    kilo: false,
    claude: true,
    group: "environment",
    timeout: 600,
    exit2: "user",
    context: "none",
    failure: false,
  },
  GoalReport: {
    description:
      "Kilo only. Before a /goal is marked complete or blocked. A block keeps the goal running. Matcher: complete, blocked.",
    kilo: true,
    claude: false,
    group: "kilo",
    matcher: "status",
    timeout: 600,
    exit2: "block",
    context: "json",
    failure: false,
  },
  WakeupFire: {
    description: "Kilo only. Before a scheduled wakeup or cron task runs. A block skips it. Matcher: once, cron.",
    kilo: true,
    claude: false,
    group: "kilo",
    matcher: "kind",
    timeout: 60,
    exit2: "block",
    context: "json",
    failure: true,
  },
  WorktreeSetup: {
    description:
      "Kilo only. After a managed worktree is created and its setup script ran. A block marks setup as failed.",
    kilo: true,
    claude: false,
    group: "kilo",
    matcher: "origin",
    timeout: 300,
    exit2: "block",
    context: "none",
    failure: true,
  },
  WorktreeTeardown: {
    description: "Kilo only. Before a managed worktree is removed.",
    kilo: true,
    claude: false,
    group: "kilo",
    timeout: 60,
    exit2: "ignore",
    context: "none",
    failure: false,
  },
  CommitMessage: {
    description:
      "Kilo only. After a commit message is generated. hookSpecificOutput.commitMessage replaces it; a block rejects it.",
    kilo: true,
    claude: false,
    group: "kilo",
    timeout: 30,
    exit2: "block",
    context: "none",
    failure: true,
  },
  BranchName: {
    description:
      "Kilo only. After a worktree branch name is generated. hookSpecificOutput.branchName replaces it; a block keeps the current name.",
    kilo: true,
    claude: false,
    group: "kilo",
    timeout: 10,
    exit2: "block",
    context: "none",
    failure: true,
  },
} as const satisfies Record<string, Meta>

export type Event = keyof typeof EVENTS

/** Events Kilo reads from ~/.claude/settings.json: the Claude Code events except ConfigChange. */
export const IMPORTED = (Object.keys(EVENTS) as Event[]).filter((key) => EVENTS[key].claude)

export type Imported = { [K in Event as (typeof EVENTS)[K]["claude"] extends true ? K : never]: (typeof EVENTS)[K] }

/** The registry entries of IMPORTED, keyed by event. */
export const IMPORTED_EVENTS = Object.fromEntries(IMPORTED.map((key) => [key, EVENTS[key]])) as Imported

/**
 * Every hook event of Claude Code 2.1.301, including the ones Kilo does not implement. Kilo-only
 * event names must never appear here.
 */
export const CLAUDE_KNOWN = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "PermissionRequest",
  "PermissionDenied",
  "Notification",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
  "PostCompact",
  "PreModelSwitch",
  "PostModelSwitch",
  "ConfigChange",
  "FileChanged",
  "CwdChanged",
  "InstructionsLoaded",
  "TaskCreated",
  "TaskCompleted",
  "Elicitation",
  "ElicitationResult",
  "Setup",
  "MessageDisplay",
  "TeammateIdle",
  "WorktreeCreate",
  "WorktreeRemove",
  "DirectoryAdded",
] as const
