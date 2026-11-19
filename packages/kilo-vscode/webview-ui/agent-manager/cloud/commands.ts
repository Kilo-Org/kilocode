import type { SlashEntry } from "../../src/v2/slash"

/** Cloud's pinned kilo@7.8.1 fallback plus its session-level compact command. Never use local project commands. */
const defaults = ["goal", "init", "kilo-config", "resume-claude", "resume-codex", "review", "compact"]
export function cloudCommands(
  reported: readonly { name: string; description?: string; hints?: readonly string[] }[] = [],
): SlashEntry[] {
  const commands = reported.length
    ? [...reported]
    : defaults.map((name) => ({ name, description: undefined, hints: undefined }))
  if (!commands.some((c) => c.name === "compact"))
    commands.push({ name: "compact", description: undefined, hints: undefined })
  return commands.map((command) => ({
    kind: "command",
    command,
    name: command.name,
    description: command.description,
    hints: [...(command.hints ?? [])],
  }))
}
