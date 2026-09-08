import { describe, expect, it } from "bun:test"
import {
  browserFeedbackData,
  browserFeedbackMetadata,
  formatBrowserFeedback,
  mergeBrowserReferences,
  partFeedback,
  parseBrowserFeedback,
  type BrowserReference,
} from "../../src/shared/browser-feedback"
import { formatReviewCommentsMarkdown } from "../../webview-ui/src/utils/review-comment-markdown"

const reference = (overrides: Partial<BrowserReference> = {}): BrowserReference => ({
  id: "browser-1",
  sessionId: "session-1",
  selector: "main > button.save",
  url: "https://user:secret@example.com/app?token=private#section",
  title: "Settings",
  hierarchy: ["main", "button.save"],
  text: "Save settings",
  html: '<button class="save">Save settings</button>',
  styles: { color: "rgb(1, 2, 3)", backgroundColor: "white" },
  source: { file: "src/settings.tsx", line: 42, column: 7 },
  content: "legacy dump and bounds",
  ...overrides,
})

describe("browser feedback formatter", () => {
  it("formats grounded fields and omits legacy content and bounds", () => {
    const text = formatBrowserFeedback([reference()])
    expect(text).toContain("Page: Settings")
    expect(text).toContain("https://example.com/app")
    expect(text).toContain("main > button.save")
    expect(text).toContain("Save settings")
    expect(text).toContain("src/settings.tsx:42:7")
    expect(text).not.toContain("secret")
    expect(text).not.toContain("token")
    expect(text).not.toContain("legacy dump")
    expect(text).not.toContain("Bounds")
  })

  it("keeps equivalent text and html from duplicating context", () => {
    const text = formatBrowserFeedback([reference({ html: "Save settings" })])
    expect(text.match(/Save settings/g)?.length).toBe(1)
    expect(text).not.toContain("HTML:")
  })

  it("includes readable text only once when a safe HTML snippet already contains it", () => {
    const text = formatBrowserFeedback([reference()])
    expect(text.match(/Save settings/g)).toHaveLength(1)
    expect(text).not.toContain("Text:")
  })

  it("updates repeated selections without duplicating the same page element", () => {
    const first = browserFeedbackData([reference()])!.references
    const merged = mergeBrowserReferences(first, reference({ id: "new-selection", text: "Updated settings" }))
    expect(merged).toHaveLength(1)
    expect(merged[0]?.id).toBe("new-selection")
    expect(merged[0]?.text).toBe("Updated settings")
    expect(merged[0]?.url).toBe("https://example.com/app")
    expect(merged[0]).not.toHaveProperty("content")
  })

  it("rejects invalid and oversized references", () => {
    expect(browserFeedbackData([])).toBeUndefined()
    expect(browserFeedbackData([reference({ selector: "x".repeat(5_000) })])).toBeUndefined()
    expect(browserFeedbackData(Array.from({ length: 21 }, (_, id) => reference({ id: String(id) })))).toBeUndefined()
    expect(browserFeedbackData([reference({ source: { file: "../secret" } })])).toBeUndefined()
    expect(browserFeedbackData([reference({ url: "file:///tmp/private" })])).toBeUndefined()
    expect(browserFeedbackData([reference({ text: "x".repeat(20_001) })])).toBeUndefined()
  })
})

describe("browser feedback metadata", () => {
  it("round-trips metadata while ignoring legacy content", () => {
    const data = browserFeedbackData([reference()])!
    const prefix = formatBrowserFeedback(data.references)
    expect(parseBrowserFeedback(data, `${prefix}\n\nFix the save action`)).toEqual(data)
    expect(partFeedback(browserFeedbackMetadata(data), `${prefix}\n\nFix the save action`)).toEqual({
      browserFeedback: data,
      body: "Fix the save action",
    })
  })

  it("rejects arbitrary text that does not match the metadata prefix", () => {
    const data = browserFeedbackData([reference()])!
    expect(parseBrowserFeedback(data, "unrelated text")).toBeUndefined()
  })

  it("coexists with local and PR review metadata", () => {
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
    const browser = browserFeedbackData([reference()])!
    const reviewPrefix = formatReviewCommentsMarkdown(review.comments)
    const browserPrefix = formatBrowserFeedback(browser.references)
    const content = `${reviewPrefix}\n\n${browserPrefix}\n\nDo both`
    expect(partFeedback({ kilo: { review, browserFeedback: browser } }, content)).toEqual({
      review,
      browserFeedback: browser,
      body: "Do both",
    })
  })
})
