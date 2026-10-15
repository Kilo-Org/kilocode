// Command parsing for the New Worktree dialog prompt.
//
// The first prompt of a new worktree is sent as a plain message by default.
// When it starts with a server-side slash command (custom command, skill, MCP
// prompt, or /goal), the dialog routes it through the command path instead so
// the backend executes the command rather than treating it as literal text.

export interface WorktreeCommandEntry {
  name: string
  source?: string
  hints?: string[]
}

export interface WorktreeCommand {
  command: string
  arguments: string
}

export interface WorktreePromptPayload {
  text?: string
  command?: string
  arguments?: string
}

/**
 * Parse a submitted prompt into a server command when it starts with one.
 *
 * Mirrors the sidebar PromptInput matching rules: an exact command name wins,
 * then a hint/alias match. Client action entries have no `source` and are
 * ignored, so their text stays a plain prompt.
 */
export function parseWorktreeCommand(
  text: string,
  commands: readonly WorktreeCommandEntry[],
): WorktreeCommand | undefined {
  const match = text.match(/^\/(\S+)/)
  const word = match?.[1]
  if (!match || !word) return undefined

  const entry =
    commands.find((item) => item.name === word) ?? commands.find((item) => (item.hints ?? []).includes(word))
  if (!entry?.source) return undefined

  return { command: entry.name, arguments: text.slice(match[0].length).trim() }
}

/**
 * Split a submitted prompt into either plain text or a server command.
 * Prefer this over `parseWorktreeCommand` when building the create message so
 * the caller does not add branching to already-complex submit handlers.
 */
export function worktreePromptPayload(text: string, commands: readonly WorktreeCommandEntry[]): WorktreePromptPayload {
  const command = parseWorktreeCommand(text, commands)
  if (command) return { command: command.command, arguments: command.arguments }
  return { text: text || undefined }
}

/**
 * True when the draft is exactly `/goal`. That enters goal composition so the
 * objective can be typed as the next step instead of dispatching immediately.
 */
export function isGoalActivation(text: string): boolean {
  return text.trim() === "/goal"
}

/**
 * True when submitting should switch to goal composition instead of creating:
 * a bare `/goal` while not already composing an objective.
 */
export function shouldComposeGoal(composing: boolean, text: string): boolean {
  return !composing && isGoalActivation(text)
}

/**
 * Build the goal command for a composed objective. The `-- ` delimiter matches
 * the chat composer, so an objective that is itself a control word still sets
 * the goal instead of pausing, resuming, or clearing.
 */
export function worktreeGoalPayload(objective: string): WorktreePromptPayload {
  return { command: "goal", arguments: `-- ${objective.trim()}` }
}

export function submitPayload(
  composing: boolean,
  text: string,
  commands: readonly WorktreeCommandEntry[],
): WorktreePromptPayload {
  return composing ? worktreeGoalPayload(text) : worktreePromptPayload(text, commands)
}
