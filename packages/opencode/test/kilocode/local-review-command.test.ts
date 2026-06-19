import { describe, expect, test } from "bun:test"
import type { Command } from "../../src/command"
import { REVIEWER_AGENT } from "../../src/kilocode/agent"
import REVIEWER_PROMPT from "../../src/kilocode/agent/prompt/reviewer.txt"
import {
  localReviewCommand,
  localReviewUncommittedCommand,
  parseReviewCommand,
  reviewerCommand,
} from "../../src/kilocode/review/command"

describe("review command parsing", () => {
  test("parses review slash commands", () => {
    expect(parseReviewCommand("/review")).toBe("review")
    expect(parseReviewCommand("/local-review -- focus tests")).toBe("local-review")
    expect(parseReviewCommand("/local-review-uncommitted focus tests")).toBe("local-review-uncommitted")
    expect(parseReviewCommand("/test")).toBeUndefined()
    expect(parseReviewCommand("local-review")).toBeUndefined()
  })
})

describe("reviewer command overlay", () => {
  test("preserves upstream command fields while assigning Reviewer", () => {
    const base: Command.Info = {
      name: "review",
      description: "review changes",
      source: "command",
      template: "Input: $ARGUMENTS",
      subtask: true,
      hints: ["$ARGUMENTS"],
    }

    expect(reviewerCommand(base)).toEqual({
      ...base,
      agent: REVIEWER_AGENT,
      subtask: true,
    })
  })
})

describe("Reviewer prompt", () => {
  test("defines the default uncommitted scope and six Explore tracks", () => {
    expect(REVIEWER_PROMPT).toContain("staged, unstaged, and untracked changes")
    expect(REVIEWER_PROMPT).toContain("Command-provided scope takes precedence")
    expect(REVIEWER_PROMPT).toContain("spawn six Explore subagents in parallel")
    expect(REVIEWER_PROMPT).toContain("security")
    expect(REVIEWER_PROMPT).toContain("performance")
    expect(REVIEWER_PROMPT).toContain("business logic")
    expect(REVIEWER_PROMPT).toContain("deploy safety")
    expect(REVIEWER_PROMPT).toContain("duplication")
    expect(REVIEWER_PROMPT).toContain("dead code")
    expect(REVIEWER_PROMPT).toContain("NO_FINDINGS")
  })

  test("does not include post-review fix workflow", () => {
    expect(REVIEWER_PROMPT).toContain("must not edit files")
    expect(REVIEWER_PROMPT).toContain("must not")
    expect(REVIEWER_PROMPT).toContain("call Question")
    expect(REVIEWER_PROMPT).not.toContain("After User Chooses")
    expect(REVIEWER_PROMPT).not.toContain("mode \"code\"")
    expect(REVIEWER_PROMPT).not.toContain("Use editing tools")
  })
})

describe("local-review command", () => {
  const cmd = localReviewCommand()

  test("targets Reviewer as a subtask", () => {
    expect(cmd.name).toBe("local-review")
    expect(cmd.agent).toBe(REVIEWER_AGENT)
    expect(cmd.subtask).toBe(true)
    expect(typeof cmd.template).toBe("string")
  })

  test("hints expose $ARGUMENTS as the only placeholder", () => {
    expect(cmd.hints).toEqual(["$ARGUMENTS"])
  })

  test("template documents free-form argument handling", () => {
    const text = cmd.template as string
    expect(text).toContain("Empty input")
    expect(text).toContain("literal free-form text")
    expect(text).toContain("Clearly requested base")
    expect(text).toContain("Base plus guidance")
    expect(text).toContain("Everything else")
    expect(text).toContain("ambiguous input as review instructions")
    expect(text).not.toContain("<base> -- <instructions>")
    expect(text).not.toContain("-- <instructions>")
  })

  test("template documents the default base priority", () => {
    const text = cmd.template as string
    expect(text).toContain("origin/main")
    expect(text).toContain("origin/master")
    expect(text).toContain("origin/dev")
    expect(text).toContain("origin/develop")
    expect(text).toContain("local `main`")
    expect(text).toContain("local `master`")
    expect(text).toContain("local `dev`")
    expect(text).toContain("local `develop`")
    expect(text).toContain("fall back to `main`")
    expect(text).toContain("Review.getBaseBranch()")
  })

  test("template instructs the model to validate the base before reviewing", () => {
    const text = cmd.template as string
    expect(text).toContain("git merge-base HEAD <base>")
    expect(text).toMatch(/no common history|not found/i)
  })

  test("template retains the branch scope contract without post-review handoff", () => {
    const text = cmd.template as string
    expect(text).toContain("git -c core.quotepath=false diff <merge-base>")
    expect(text).toContain("git show-ref --verify --quiet")
    expect(text).toContain("verify it is not a symlink")
    expect(text).toContain("do not follow the link")
    expect(text).toContain("## Local Review for **branch diff**")
    expect(text).not.toContain("Post-Review Workflow")
    expect(text).not.toContain("question tool")
    expect(text).not.toContain("After User Chooses")
    expect(text).not.toContain("Use editing tools")
  })
})

describe("local-review-uncommitted command", () => {
  const cmd = localReviewUncommittedCommand()

  test("targets Reviewer as a subtask", () => {
    expect(cmd.name).toBe("local-review-uncommitted")
    expect(cmd.agent).toBe(REVIEWER_AGENT)
    expect(cmd.subtask).toBe(true)
    expect(typeof cmd.template).toBe("string")
  })

  test("hints expose $ARGUMENTS as the only placeholder", () => {
    expect(cmd.hints).toEqual(["$ARGUMENTS"])
  })

  test("template includes $ARGUMENTS in a user input section", () => {
    const text = cmd.template as string
    expect(text).toContain("## User Input\n\n$ARGUMENTS")
  })

  test("template documents free-form user guidance", () => {
    const text = cmd.template as string
    expect(text).toContain("literal free-form review guidance")
    expect(text).toContain("never changes the diff scope")
    expect(text).toContain("no base branch selection")
    expect(text).toContain("MUST NOT override the diff scope")
  })

  test("template retains the uncommitted scope contract without post-review handoff", () => {
    const text = cmd.template as string
    expect(text).toMatch(/git\b[^\n]*\bdiff HEAD/)
    expect(text).toMatch(/git\b[^\n]*\bdiff --cached/)
    expect(text).toContain("git ls-files --others --exclude-standard")
    expect(text).toContain("verify it is not a symlink")
    expect(text).toContain("do not follow the link")
    expect(text).toContain("## Local Review for **uncommitted changes**")
    expect(text).not.toContain("Post-Review Workflow")
    expect(text).not.toContain("question tool")
    expect(text).not.toContain("After User Chooses")
    expect(text).not.toContain("Use editing tools")
  })
})
