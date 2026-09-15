import { describe, expect, it } from "bun:test"
import {
  codeContextLabel,
  formatCodeContext,
  formatCodeContexts,
  mergeCodeContexts,
  type CodeContext,
} from "../../src/shared/code-context"
import { browserFeedbackData, formatBrowserFeedback, partFeedback } from "../../src/shared/browser-feedback"
import { formatReviewCommentsMarkdown } from "../../webview-ui/src/utils/review-comment-markdown"
import { createPrompt } from "../../src/services/code-actions/support-prompt"

function context(overrides: Partial<CodeContext> = {}): CodeContext {
  return {
    id: "1",
    filePath: "tests/unit/services/test_subchannel_sharing.py",
    startLine: 271,
    endLine: 277,
    text: "writer_count.return_value = 2",
    ...overrides,
  }
}

describe("codeContextLabel", () => {
  it("uses the base name with the selected line range", () => {
    expect(codeContextLabel(context())).toBe("test_subchannel_sharing.py:271-277")
  })

  it("handles windows separators and empty file names", () => {
    expect(codeContextLabel(context({ filePath: "src\\app\\main.ts" }))).toBe("main.ts:271-277")
    expect(codeContextLabel(context({ filePath: "" }))).toBe(":271-277")
  })
})

describe("formatCodeContext", () => {
  it("matches the legacy editor prompt shape", () => {
    const value = context()
    expect(formatCodeContext(value)).toBe(
      createPrompt("ADD_TO_CONTEXT", {
        filePath: value.filePath,
        startLine: String(value.startLine),
        endLine: String(value.endLine),
        selectedText: value.text,
      }),
    )
  })
})

describe("formatCodeContexts", () => {
  it("joins multiple selections with a blank line", () => {
    const first = context()
    const second = context({ id: "2", filePath: "src/file.ts", startLine: 3, endLine: 5 })
    expect(formatCodeContexts([first, second])).toBe(`${formatCodeContext(first)}\n\n${formatCodeContext(second)}`)
  })
})

describe("mergeCodeContexts", () => {
  it("ignores duplicates and keeps distinct selections", () => {
    const first = context()
    const duplicate = context({ id: "other" })
    const other = context({ id: "2", startLine: 300, endLine: 305 })
    expect(mergeCodeContexts([first], [duplicate])).toEqual([first])
    expect(mergeCodeContexts([first], [other])).toEqual([first, other])
  })
})

describe("code context feedback composition", () => {
  const review = {
    version: 1 as const,
    comments: [
      {
        id: "review-1",
        file: "src/app.ts",
        side: "additions" as const,
        line: 3,
        comment: "Keep this branch safe",
        selectedText: "return value",
      },
    ],
  }
  const browser = browserFeedbackData([
    {
      id: "browser-1",
      sessionId: "session-1",
      selector: "main > button.save",
      url: "https://example.com/app",
      text: "Save settings",
    },
  ])!
  const reviewPrefix = formatReviewCommentsMarkdown(review.comments)
  const browserPrefix = formatBrowserFeedback(browser.references)
  const codeContext = formatCodeContexts([context()])
  const draft = "Please review"
  const push =
    "When the changes pass local checks, commit them and push to this branch so the pull request updates. Do not force-push."

  // Code context is not feedback metadata, so it must follow the review and
  // browser sections. Leading with it makes parseFeedback return undefined and
  // the host can no longer rebuild the review and browser cards.
  it("keeps review metadata parseable with a selection attached", () => {
    const content = [reviewPrefix, push, codeContext, draft].filter(Boolean).join("\n\n")
    expect(partFeedback({ kilo: { review } }, content)).toMatchObject({
      review,
      body: `${push}\n\n${codeContext}\n\n${draft}`,
    })
  })

  // The parsers strip the review prefix first, then require the browser prefix
  // at the start of the remaining body, so review, browser, and push must stay
  // adjacent even when a push instruction is present.
  it("keeps review and browser metadata parseable when a push instruction is present", () => {
    const content = [reviewPrefix, browserPrefix, push, codeContext, draft].filter(Boolean).join("\n\n")
    expect(partFeedback({ kilo: { review, browserFeedback: browser } }, content)).toMatchObject({
      review,
      browserFeedback: browser,
      body: `${push}\n\n${codeContext}\n\n${draft}`,
    })
  })

  it("keeps browser metadata parseable without review metadata", () => {
    const content = [browserPrefix, push, codeContext, draft].filter(Boolean).join("\n\n")
    expect(partFeedback({ kilo: { browserFeedback: browser } }, content)).toMatchObject({
      browserFeedback: browser,
      body: `${push}\n\n${codeContext}\n\n${draft}`,
    })
  })
})
