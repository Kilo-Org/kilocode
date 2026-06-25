import type { Command } from "@/command"
import type { ReviewCommand } from "@kilocode/kilo-telemetry"
import REVIEW from "./review.txt"

const legacy: Record<string, { description: string; message: string }> = {
  "local-review": {
    description: "deprecated; use /review branch",
    message: "/local-review is deprecated. Use /review branch instead.",
  },
  "local-review-uncommitted": {
    description: "deprecated; use /review uncommitted",
    message: "/local-review-uncommitted is deprecated. Use /review uncommitted instead.",
  },
}

export function isReviewCommand(command: string | undefined): command is ReviewCommand {
  return command === "review"
}

export function parseReviewCommand(prompt: string | undefined): ReviewCommand | undefined {
  if (!prompt?.startsWith("/")) return
  const name = prompt.slice(1).split(/\s/, 1)[0]
  if (isReviewCommand(name)) return name
}

export function reviewCommand(): Command.Info {
  return {
    name: "review",
    description: "review changes [uncommitted|commit|branch|pr]",
    template: REVIEW,
    hints: ["$ARGUMENTS"],
  }
}

export function legacyReviewMessage(name: string) {
  return legacy[name]?.message
}

export function legacyReviewCommand(name: string): Command.Info | undefined {
  const item = legacy[name]
  if (!item) return
  return {
    name,
    description: item.description,
    template: item.message,
    hints: [],
  }
}
