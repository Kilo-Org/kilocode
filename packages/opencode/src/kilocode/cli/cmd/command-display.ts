import { reviewCommandName } from "@/kilocode/review/command"

type Command = {
  name: string
  source?: "command" | "mcp" | "skill"
}

export function slashDisplay(cmd: Command) {
  if (cmd.source === "skill") return `/${cmd.name}:skill`
  if (cmd.source === "mcp") return `/${cmd.name}:mcp`
  return `/${cmd.name}`
}

export function slashMatches(cmd: Command, name: string) {
  if (cmd.name === "review" && reviewCommandName(name)) return true
  return cmd.name === name || slashDisplay(cmd).slice(1) === name
}
