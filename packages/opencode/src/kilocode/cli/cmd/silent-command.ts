import { slashMatches } from "./command-display"

type Command = {
  name: string
  source?: "command" | "mcp" | "skill"
  agent?: string
  silent?: boolean
}

export function silentAgent(text: string, commands: readonly Command[]) {
  if (!text.startsWith("/")) return
  const name = text.split("\n")[0].split(" ")[0].slice(1)
  const command = commands.find((item) => slashMatches(item, name))
  if (command?.source !== "command" || command.silent !== true) return
  return command.agent
}
