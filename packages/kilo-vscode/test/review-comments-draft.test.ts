import { describe, expect, it } from "bun:test"
import {
  PUSH_INSTRUCTION,
  partReview,
  type PRReviewCommentData,
  type ReviewCommentData,
} from "../src/shared/review-comments"
import { takeReviewCommentsForPromptBatch } from "../webview-ui/diff-viewer/review-annotations"
import { composeReviewPrompt, mergeReviewComments } from "../webview-ui/src/v2/review-drafts"

function local(id = "c-1"): ReviewCommentData {
  return { id, file: "src/file.ts", side: "additions", line: 2, comment: "Use the helper", selectedText: "old" }
}

function pr(id = "c-pr"): PRReviewCommentData {
  return { id, origin: "pr", author: "octocat", body: "Please fix", file: "src/file.ts", line: 4 }
}

describe("review comment drafts", () => {
  it("merges comments by id and keeps the later copy", () => {
    const first = mergeReviewComments([local("a"), local("b")], [local("b"), local("c")])
    expect(first.map((item) => item.id)).toEqual(["a", "b", "c"])

    const replaced = mergeReviewComments([local("a")], [{ ...local("a"), comment: "Changed" }])
    expect(replaced).toEqual([{ ...local("a"), comment: "Changed" }])
  })

  it("keeps the current list when nothing arrives", () => {
    const current = [local()]
    expect(mergeReviewComments(current, [])).toBe(current)
  })

  it("composes the review markdown and the metadata of one send", () => {
    const comments = [local()]
    const prompt = composeReviewPrompt(comments, "  Also rename it  ", true)

    expect(prompt.text.startsWith("## Review Comments\n")).toBe(true)
    expect(prompt.text.endsWith("Also rename it")).toBe(true)
    // The metadata must survive the JSON boundary to the server and back.
    expect(JSON.parse(JSON.stringify(prompt.metadata))).toEqual({ kilo: { review: { version: 1, comments } } })
  })

  it("sends only the review prefix when the body is empty", () => {
    const prompt = composeReviewPrompt([local()], "", true)
    expect(prompt.text).not.toContain("\n\n\n")
    expect(partReview(prompt.metadata, prompt.text)?.body).toBe("")
  })

  it("round-trips its own composition for the message view", () => {
    const comments = [local("a"), pr("b")]
    const prompt = composeReviewPrompt(comments, "Do both", false)
    const parsed = partReview(prompt.metadata, prompt.text)

    expect(parsed?.data.comments).toEqual(comments)
    expect(parsed?.body).toBe("Do both")
  })

  it("adds the push instruction only for remote feedback when enabled", () => {
    expect(composeReviewPrompt([local()], "", true).text).not.toContain(PUSH_INSTRUCTION)
    expect(composeReviewPrompt([pr()], "", false).text).not.toContain(PUSH_INSTRUCTION)
    expect(composeReviewPrompt([pr()], "", true).text).toContain(PUSH_INSTRUCTION)
  })

  it("leaves text alone when there are no comments", () => {
    expect(composeReviewPrompt([], "  Hello  ", true)).toEqual({ text: "Hello" })
  })

  it("takes an untargeted batch for the composer and marks it handled", () => {
    const detail = { comments: [local()], send: "enter" as const }
    expect(takeReviewCommentsForPromptBatch(detail)).toEqual([local()])
    expect(detail).toHaveProperty("handled", true)
    expect(takeReviewCommentsForPromptBatch(detail)).toBeUndefined()
  })

  it("leaves a terminal-targeted batch to the terminal", () => {
    expect(
      takeReviewCommentsForPromptBatch({ comments: [local()], send: "alternate", targetTerminalId: "t-1" }),
    ).toBe(undefined)
  })
})
