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
export function worktreePromptPayload(
  text: string,
  commands: readonly WorktreeCommandEntry[],
): { text?: string; command?: string; arguments?: string } {
  const command = parseWorktreeCommand(text, commands)
  if (command) return { command: command.command, arguments: command.arguments }
  return { text: text || undefined }
}
