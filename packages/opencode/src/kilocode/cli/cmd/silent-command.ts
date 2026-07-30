import { slashMatches } from "./command-display"

type Command = {
  name: string
  source?: "command" | "mcp" | "skill"
  agent?: string
  silent?: boolean
}

export function silentAgent(text: string, commands: readonly Command[]) {
  const match = text.match(/^\/([^\s]+)[ \t]*$/)
  if (!match) return
  const name = match[1]
  const command = commands.find((item) => slashMatches(item, name))
  if (command?.source !== "command" || command.silent !== true) return
  return command.agent
}
