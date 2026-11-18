import { afterEach, describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import { partReview, type ChatReferenceData, type ReviewCommentData } from "../src/shared/review-comments"
import { composeReviewPrompt } from "../webview-ui/src/v2/review-drafts"
import { anchorRange, findQuote, selectionAnchor, wholeWords } from "../webview-ui/src/v2/transcript-reply-anchor"

const reference = (comment: string, quote = "Share a single in-flight refresh promise"): ChatReferenceData => ({
  id: `chat-${comment || "quote"}`,
  origin: "chat",
  messageID: "msg_1",
  partID: "msg_1:part_2",
  offset: 12,
  quote,
  comment,
})

describe("chat references in a prompt", () => {
  it("quotes the passage and keeps the comment after it", () => {
    const review = composeReviewPrompt([reference("Why not a mutex?"), reference("")], "Thanks", false)
    expect(review.text).toBe(
      [
        "## Replies to Your Earlier Answers",
        "",
        "On this part of your earlier answer:",
        "> Share a single in-flight refresh promise",
        "",
        "Why not a mutex?",
        "",
        "Quoting your earlier answer:",
        "> Share a single in-flight refresh promise",
        "",
        "Thanks",
      ].join("\n"),
    )
  })

  it("reads the references back from the sent prompt", () => {
    const sent = [reference("Why not a mutex?"), reference("", "line one\nline two")]
    const review = composeReviewPrompt(sent, "Thanks", false)
    const view = partReview(review.metadata, review.text)
    expect(view?.data.comments).toEqual(sent)
    expect(view?.body).toBe("Thanks")
  })

  it("uses the review heading when chat references travel with diff comments", () => {
    const local: ReviewCommentData = {
      id: "c1",
      file: "src/a.ts",
      side: "additions",
      line: 3,
      comment: "rename",
      selectedText: "",
    }
    const review = composeReviewPrompt([local, reference("why?")], "", false)
    expect(review.text.startsWith("## Review Comments\n")).toBe(true)
    expect(partReview(review.metadata, review.text)?.data.comments).toHaveLength(2)
  })

  it("rejects a reference without a valid location", () => {
    const review = composeReviewPrompt([reference("why?")], "", false)
    const broken = { kilo: { review: { version: 1, comments: [{ ...reference("why?"), offset: -1 }] } } }
    expect(partReview(broken, review.text)).toBeUndefined()
  })
})

describe("findQuote", () => {
  it("prefers the recorded offset", () => {
    expect(findQuote("ab ab ab", "ab", 3)).toBe(3)
  })

  it("falls back to the nearest occurrence when the text moved", () => {
    expect(findQuote("xx ab ab ab", "ab", 7)).toBe(6)
    expect(findQuote("ab", "missing", 0)).toBeUndefined()
  })
})

describe("wholeWords", () => {
  it("widens a selection that starts or ends inside a word", () => {
    expect(wholeWords("when a refresh fails, reject", 2, 23)).toEqual({
      offset: 0,
      quote: "when a refresh fails, reject",
    })
  })

  it("keeps a selection on word boundaries and trims whitespace", () => {
    expect(wholeWords("one two three", 3, 8)).toEqual({ offset: 4, quote: "two" })
    expect(wholeWords("a,  b", 1, 4)).toEqual({ offset: 1, quote: "," })
  })

  it("rejects a selection of only whitespace", () => {
    expect(wholeWords("a   b", 1, 4)).toBeUndefined()
  })
})

const windows: Window[] = []

afterEach(() => {
  for (const window of windows.splice(0)) window.close()
})

function transcript() {
  const window = new Window()
  windows.push(window)
  const doc = window.document as unknown as Document
  doc.body.innerHTML = `
    <div class="message-list">
      <div data-row="assistant" data-message="msg_1">
        <div data-part-id="msg_1:part_2">
          <div data-component="text-part">
            <div data-slot="text-part-body"><p>I found <code>the race</code>.</p><p>Two requests share it.</p></div>
            <div data-slot="assistant-copy-wrapper">Copy</div>
          </div>
        </div>
      </div>
    </div>`
  return doc
}

describe("transcript anchors", () => {
  it("anchors a selection across inline code and paragraphs, and finds it again", () => {
    const doc = transcript()
    const paragraphs = doc.querySelectorAll("p")
    const range = doc.createRange()
    range.setStart(paragraphs[0]!.firstChild!, 2)
    range.setEnd(paragraphs[1]!.firstChild!, 3)

    const anchor = selectionAnchor(range)
    expect(anchor).toEqual({ messageID: "msg_1", partID: "msg_1:part_2", offset: 2, quote: "found the race.Two" })

    const found = anchorRange(doc.body, anchor!)
    expect(found?.toString()).toBe("found the race.Two")
  })

  it("cuts a selection that runs past the answer text at its end", () => {
    const doc = transcript()
    const range = doc.createRange()
    range.setStart(doc.querySelectorAll("p")[1]!.firstChild!, 0)
    range.setEnd(doc.querySelector('[data-slot="assistant-copy-wrapper"]')!.firstChild!, 2)
    expect(selectionAnchor(range)?.quote).toBe("Two requests share it.")
  })

  it("ignores a selection that starts outside the answer text", () => {
    const doc = transcript()
    const range = doc.createRange()
    range.setStart(doc.querySelector('[data-slot="assistant-copy-wrapper"]')!.firstChild!, 0)
    range.setEnd(doc.querySelector('[data-slot="assistant-copy-wrapper"]')!.firstChild!, 2)
    expect(selectionAnchor(range)).toBeUndefined()
  })

  it("starts a passage at the beginning of a paragraph in that paragraph, not at the end of the one before", () => {
    const doc = transcript()
    const found = anchorRange(doc.body, { messageID: "msg_1", partID: "msg_1:part_2", offset: 15, quote: "Two" })
    expect(found?.toString()).toBe("Two")
    expect(found?.startContainer).toBe(doc.querySelectorAll("p")[1]!.firstChild!)
  })

  it("finds nothing when the row is not mounted", () => {
    const doc = transcript()
    expect(anchorRange(doc.body, { messageID: "msg_2", partID: "msg_1:part_2", offset: 0, quote: "I" })).toBeUndefined()
  })
})
