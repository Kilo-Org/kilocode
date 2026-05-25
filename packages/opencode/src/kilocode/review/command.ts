import type { Command } from "@/command"
import type { ReviewCommand } from "@kilocode/kilo-telemetry"
import LOCAL_REVIEW from "./local-review.txt"
import LOCAL_REVIEW_UNCOMMITTED from "./local-review-uncommitted.txt"

export function isReviewCommand(command: string | undefined): command is ReviewCommand {
  return command === "review" || command === "local-review" || command === "local-review-uncommitted"
}

export function parseReviewCommand(prompt: string | undefined): ReviewCommand | undefined {
  if (!prompt?.startsWith("/")) return
  const name = prompt.slice(1).split(/\s/, 1)[0]
  if (isReviewCommand(name)) return name
}

/**
 * /local-review-uncommitted - local review (uncommitted changes)
 */
export function localReviewUncommittedCommand(): Command.Info {
  return {
    name: "local-review-uncommitted",
    description: "local review (uncommitted changes)",
    template: LOCAL_REVIEW_UNCOMMITTED,
    hints: ["$ARGUMENTS"],
  }
}

/**
 * /local-review - local review (current branch vs base)
 */
export function localReviewCommand(): Command.Info {
  return {
    name: "local-review",
    description: "local review (current branch, optional base or instructions)",
    template: LOCAL_REVIEW,
    hints: ["$ARGUMENTS"],
  }
}
