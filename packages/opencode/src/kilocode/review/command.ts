import type { Command } from "@/command"
import type { ReviewCommand } from "@kilocode/kilo-telemetry"
import REVIEW from "./review.txt"

export function isReviewCommand(command: string | undefined): command is ReviewCommand {
  return command === "review"
}

export function reviewCommandName(command: string | undefined): ReviewCommand | undefined {
  if (isReviewCommand(command)) return command
}

export function parseReviewCommand(prompt: string | undefined): ReviewCommand | undefined {
  if (!prompt?.startsWith("/")) return
  const name = prompt.slice(1).split(/\s/, 1)[0]
  return reviewCommandName(name)
}

export function reviewCommand(): Command.Info {
  return {
    name: "review",
    description: "review changes [uncommitted|staged|unpushed|branch|commit|pr]",
    template: REVIEW,
    hints: ["$ARGUMENTS"],
  }
}
