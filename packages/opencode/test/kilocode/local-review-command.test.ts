import { describe, expect, test } from "bun:test"
import { localReviewCommand, localReviewUncommittedCommand, parseReviewCommand } from "../../src/kilocode/review/command"

describe("review command parsing", () => {
  test("parses review slash commands", () => {
    expect(parseReviewCommand("/review")).toBe("review")
    expect(parseReviewCommand("/local-review -- focus tests")).toBe("local-review")
    expect(parseReviewCommand("/local-review-uncommitted focus tests")).toBe("local-review-uncommitted")
    expect(parseReviewCommand("/test")).toBeUndefined()
    expect(parseReviewCommand("local-review")).toBeUndefined()
  })
})

describe("local-review command", () => {
  const cmd = localReviewCommand()

  test("exposes a static string template", () => {
    expect(cmd.name).toBe("local-review")
    expect(typeof cmd.template).toBe("string")
  })

  test("template includes $ARGUMENTS for raw user input", () => {
    expect(cmd.template).toContain("$ARGUMENTS")
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

  test("template avoids dereferencing untracked symlinks", () => {
    const text = cmd.template as string
    expect(text).toContain("verify it is not a symlink")
    expect(text).toContain("do not follow the link")
  })

  test("template tells the model not to edit files", () => {
    const text = cmd.template as string
    expect(text).toContain("DO NOT modify any files")
  })

  test("template applies the review-pr high-signal review focus", () => {
    const text = cmd.template as string
    expect(text).toContain("Review only these things")
    expect(text).toContain("deploy safety")
    expect(text).toContain("duplicated code or duplicated logic")
    expect(text).toContain("dead code caused by the reviewed changes")
    expect(text).toContain("Do not review these things")
    expect(text).toContain("code style")
    expect(text).toContain("generic refactors with no bug or product risk")
  })

  test("template applies the review-pr parallel review tracks", () => {
    const text = cmd.template as string
    expect(text).toContain("spawn six sub-agents in parallel")
    expect(text).toContain("security")
    expect(text).toContain("performance")
    expect(text).toContain("business logic")
    expect(text).toContain("NO_FINDINGS")
  })
})

describe("local-review-uncommitted command", () => {
  const cmd = localReviewUncommittedCommand()

  test("exposes a static string template", () => {
    expect(cmd.name).toBe("local-review-uncommitted")
    expect(typeof cmd.template).toBe("string")
  })

  test("template includes $ARGUMENTS for raw user input", () => {
    expect(cmd.template).toContain("$ARGUMENTS")
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

  test("template documents the uncommitted scope and key git commands", () => {
    const text = cmd.template as string
    expect(text).toMatch(/git\b[^\n]*\bdiff HEAD/)
    expect(text).toMatch(/git\b[^\n]*\bdiff --cached/)
    expect(text).toContain("git ls-files --others --exclude-standard")
  })

  test("template avoids dereferencing untracked symlinks", () => {
    const text = cmd.template as string
    expect(text).toContain("verify it is not a symlink")
    expect(text).toContain("do not follow the link")
  })

  test("template tells the model not to edit files", () => {
    const text = cmd.template as string
    expect(text).toContain("DO NOT modify any files")
  })

  test("template applies the review-pr high-signal review focus", () => {
    const text = cmd.template as string
    expect(text).toContain("Review only these things")
    expect(text).toContain("deploy safety")
    expect(text).toContain("duplicated code or duplicated logic")
    expect(text).toContain("dead code caused by the reviewed changes")
    expect(text).toContain("Do not review these things")
    expect(text).toContain("code style")
    expect(text).toContain("generic refactors with no bug or product risk")
  })

  test("template applies the review-pr parallel review tracks", () => {
    const text = cmd.template as string
    expect(text).toContain("spawn six sub-agents in parallel")
    expect(text).toContain("security")
    expect(text).toContain("performance")
    expect(text).toContain("business logic")
    expect(text).toContain("NO_FINDINGS")
  })
})
