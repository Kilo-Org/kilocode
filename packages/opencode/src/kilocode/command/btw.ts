import type { Command } from "@/command"

export function btwCommand(): Command.Info {
  return {
    name: "btw",
    description: "ask a side question without adding it to the conversation",
    template: "",
    hints: ["$ARGUMENTS"],
  }
}

export function isBtwCommand(name: string | undefined): boolean {
  return name === "btw"
}
