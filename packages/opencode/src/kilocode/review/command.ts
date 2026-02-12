// kilocode_change - new file
import type { Command } from "@/command"
import { Review } from "./review"

/**
 * /local-review-uncommitted - local review (uncommitted changes)
 */
export function localReviewUncommittedCommand(): Command.Info {
  return {
    name: "local-review-uncommitted",
    description: "local review (uncommitted changes)",
    hidden: true,
    get template() {
      return Review.buildReviewPromptUncommitted()
    },
    hints: [],
  }
}

/**
 * /local-review - local review (current branch vs base)
 */
export function localReviewCommand(): Command.Info {
  return {
    name: "local-review",
    description: "local review (current branch)",
    hidden: true,
    get template() {
      return Review.buildReviewPromptBranch()
    },
    hints: [],
  }
}
