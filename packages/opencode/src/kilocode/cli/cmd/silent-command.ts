import { slashMatches } from "./command-display"

type Command = {
  name: string
  source?: "command" | "mcp" | "skill"
  agent?: string
  silent?: boolean
}

type Input = {
  text: string
  mode: "normal" | "shell"
  parts: number
  editor: "none" | "pending" | "sent"
}

export function silentAgent(input: Input, commands: readonly Command[]) {
  if (input.mode !== "normal" || input.parts > 0 || input.editor === "pending") return
  const match = input.text.match(/^\/([^\s]+)[ \t]*$/)
  if (!match) return
  const name = match[1]
  const command = commands.find((item) => slashMatches(item, name))
  if (command?.source !== "command" || command.silent !== true) return
  return command.agent
}
