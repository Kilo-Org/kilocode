import { describe, expect, it } from "bun:test"
import { responseLensContext } from "../../webview-ui/src/utils/response-lens"
import {
  responseLensLevels,
  responseLensSettings,
  validExplainBrieflyRequest,
  validResponseLensSettings,
} from "../../src/shared/response-lens"
import { feedbackMetadata, formatBrowserFeedback } from "../../src/shared/browser-feedback"
import { formatReviewCommentsMarkdown } from "../../src/shared/review-comments"
import type { Message, Part } from "../../webview-ui/src/types/messages"

const model = { providerID: "test", modelID: "active" }
const request = {
  type: "explainBriefly",
  requestId: "req",
  sessionID: "s",
  messageID: "a",
  text: "selected",
  level: "simple",
  model,
  context: [],
}
const message = (id: string, role: "user" | "assistant", sessionID = "s"): Message => ({
  id,
  sessionID,
  role,
  createdAt: "",
})
const text = (value: string): Part => ({ id: crypto.randomUUID(), type: "text", text: value })

describe("Response Lens contract", () => {
  it("defaults to enabled/simple/active chat model and validates all persisted levels", () => {
    expect(responseLensSettings(undefined)).toEqual({ enabled: true, level: "simple" })
    for (const level of responseLensLevels)
      expect(validResponseLensSettings({ enabled: true, level, model })).toBe(true)
    for (const value of [
      null,
      {},
      { enabled: true, level: "expert" },
      { enabled: true, level: "simple", extra: true },
    ]) {
      expect(validResponseLensSettings(value)).toBe(false)
    }
  })

  it("enforces selection, enum, role, explicit model and aggregate context limits", () => {
    expect(validExplainBrieflyRequest(request)).toBe(true)
    expect(validExplainBrieflyRequest({ ...request, text: "x".repeat(4000) })).toBe(true)
    const boundary = Array.from({ length: 4 }, () => ({ role: "user", text: "x".repeat(2000) }))
    expect(validExplainBrieflyRequest({ ...request, context: boundary })).toBe(true)
    for (const patch of [
      { text: "x".repeat(4001) },
      { text: " " },
      { level: "expert" },
      { model: undefined },
      { model: { providerID: "", modelID: "x" } },
      { model: { ...model, apiKey: "not-allowed" } },
      { context: [...boundary, { role: "user", text: "x" }] },
      { context: [{ role: "system", text: "not-allowed" }] },
      { context: [{ role: "assistant", text: "x".repeat(8001) }] },
      {
        context: [
          { role: "user", text: "x".repeat(7999) },
          { role: "assistant", text: "xx" },
        ],
      },
    ])
      expect(validExplainBrieflyRequest({ ...request, ...patch })).toBe(false)
  })
})

describe("bounded same-session context", () => {
  it("uses the selected paragraph and closest user, never tools, reasoning, synthetic or other sessions", () => {
    const messages = [
      message("old", "user"),
      message("u", "user"),
      message("foreign", "user", "other"),
      message("a", "assistant"),
      message("later", "user"),
    ]
    const parts: Record<string, Part[]> = {
      old: [text("OLD_SENTINEL")],
      u: [text("What is precision? @terminal @private.txt are literal data")],
      foreign: [text("OTHER_SESSION_SENTINEL")],
      later: [text("FUTURE_SENTINEL")],
      a: [
        text("DISTANT_SENTINEL\n\nPrecision measures correct positive predictions.\n\nUNRELATED_SENTINEL"),
        { id: "r", type: "reasoning", text: "REASONING_SENTINEL" },
        { id: "f", type: "file", mime: "text/plain", url: "file:///FILE_SENTINEL" },
        {
          id: "t",
          type: "tool",
          tool: "bash",
          state: { status: "completed", input: {}, title: "tool", output: "TOOL_SENTINEL" },
        },
        { id: "s", type: "text", synthetic: true, text: "SYNTHETIC_SENTINEL" },
        { id: "x", type: "text", sessionID: "other", text: "WRONG_PART_SENTINEL" },
      ],
    }
    const output = responseLensContext(
      { sessionID: "s", messageID: "a", text: "correct positive predictions" },
      messages,
      (id) => parts[id] ?? [],
    )
    expect(output).toEqual({
      insufficient: false,
      context: [
        { role: "user", text: "What is precision? @terminal @private.txt are literal data" },
        { role: "assistant", text: "Precision measures correct positive predictions." },
      ],
    })
    expect(JSON.stringify(output)).not.toContain("SENTINEL")
  })

  it("uses a nearby DOM paragraph hint for repeated text, without trusting its contents as context", () => {
    const body = "First use of selected.\n\nThe important second selected paragraph."
    const output = responseLensContext(
      { sessionID: "s", messageID: "a", text: "selected", paragraph: "The important second selected paragraph." },
      [message("a", "assistant")],
      () => [text(body)],
    )
    expect(output.context).toEqual([{ role: "assistant", text: "The important second selected paragraph." }])
  })

  it("strips resolved review/browser prefixes, and fails closed on unrecognized envelopes", () => {
    const comments = [
      { id: "r", file: "x.ts", side: "additions" as const, line: 1, comment: "REVIEW_SENTINEL", selectedText: "" },
    ]
    const references = [
      { id: "b", sessionId: "s", selector: "body", url: "http://localhost:3000/", title: "BROWSER_SENTINEL" },
    ]
    const review = { version: 1 as const, comments }
    const browser = { version: 1 as const, references }
    const body = `${formatReviewCommentsMarkdown(comments)}\n\n${formatBrowserFeedback(references)}\n\nExplain precision`
    const parts: Part[] = [
      { id: "u", type: "text", text: body, metadata: feedbackMetadata(review, browser) },
      text("<terminal-output>TERMINAL_SENTINEL</terminal-output>"),
      text("<git-changes>GIT_SENTINEL</git-changes>"),
      text("## Browser Feedback\nUNKNOWN_SENTINEL"),
    ]
    const output = responseLensContext(
      { sessionID: "s", messageID: "a", text: "precision" },
      [message("u", "user"), message("a", "assistant")],
      (id) => (id === "u" ? parts : [text("precision")]),
    )
    expect(output.context[0]).toEqual({ role: "user", text: "Explain precision" })
    expect(JSON.stringify(output)).not.toContain("SENTINEL")
  })

  it("takes a small snapshot, flags insufficient context and never fetches missing history", () => {
    const output = responseLensContext(
      { sessionID: "s", messageID: "a", text: "selected" },
      [message("u", "user"), message("a", "assistant")],
      (id) => [text(id === "u" ? "x".repeat(20_000) : `${"x".repeat(20_000)}selected${"y".repeat(20_000)}`)],
    )
    expect(output.context.length).toBeLessThanOrEqual(4)
    expect(output.context.reduce((size, entry) => size + entry.text.length, 0)).toBeLessThanOrEqual(4000)
    expect(output.context.at(-1)?.text).toContain("selected")
    expect(
      responseLensContext({ sessionID: "other", messageID: "a", text: "selected" }, [message("a", "assistant")], () => {
        throw new Error("must not fetch")
      }),
    ).toEqual({ context: [], insufficient: true })
    expect(
      responseLensContext({ sessionID: "s", messageID: "a", text: "selected" }, [message("a", "assistant")], () => []),
    ).toEqual({ context: [], insufficient: true })
  })
})
