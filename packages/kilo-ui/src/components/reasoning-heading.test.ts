import { describe, expect, test } from "bun:test"
import { reasoningHeading, reasoningSummary } from "./reasoning-heading"

describe("reasoning heading", () => {
  test("promotes a leading strong line into the title", () => {
    expect(reasoningHeading("**Counting distinct users**\n\nI should aggregate the fixed version first.")).toEqual({
      title: "Counting distinct users",
      body: "I should aggregate the fixed version first.",
    })
  })

  test("promotes an unfinished strong line while streaming", () => {
    expect(reasoningHeading("**Assessing the", true)).toEqual({ title: "Assessing the", body: "" })
  })

  test("keeps an unfinished strong line in the body when complete", () => {
    expect(reasoningHeading("**Assessing the")).toEqual({ body: "**Assessing the" })
  })

  test("keeps multiline unfinished strong text in the body while streaming", () => {
    const text = "**Assessing the\nnext possibility"
    expect(reasoningHeading(text, true)).toEqual({ body: text })
  })

  test("promotes heading syntax and keeps the remaining markdown", () => {
    expect(reasoningHeading("## Check `Slack` [requests](https://example.com) ##\n\n- Inspect the command")).toEqual({
      title: "Check Slack requests",
      body: "- Inspect the command",
    })
  })

  test("keeps plain lead-in text instead of lifting a later heading", () => {
    const text = "First inspect the query.\n\n**Then summarize it**\n\nKeep working."
    expect(reasoningHeading(text)).toEqual({ body: text })
  })

  test("supports setext headings after normalizing line endings", () => {
    expect(reasoningHeading("Review the plan\r\n---------------\r\n\r\nCompare the tradeoffs.")).toEqual({
      title: "Review the plan",
      body: "Compare the tradeoffs.",
    })
  })

  test("promotes HTML headings while flattening inline tags", () => {
    expect(
      reasoningHeading('<h3 class="step">Check <em>provider</em> status</h3>\n\nContinue with the next item.'),
    ).toEqual({
      title: "Check provider status",
      body: "Continue with the next item.",
    })
  })

  test("keeps strong lead-in prose in the body", () => {
    const text = "**Important** because the result can change.\n\nKeep analyzing."
    expect(reasoningHeading(text)).toEqual({ body: text })
  })

  test("promotes an underscore strong title without body text", () => {
    expect(reasoningHeading("__Summarize constraints__")).toEqual({
      title: "Summarize constraints",
      body: "",
    })
  })

  test("treats an OpenAI placeholder comment as an empty body", () => {
    expect(reasoningHeading("**Assessing search behavior**\n\n<!-- -->")).toEqual({
      title: "Assessing search behavior",
      body: "",
    })
  })

  test("preserves visible body text around HTML comments", () => {
    expect(reasoningHeading("**Assessing search behavior**\n\n<!-- status -->\nContinue checking results.")).toEqual({
      title: "Assessing search behavior",
      body: "<!-- status -->\nContinue checking results.",
    })
  })

  test("treats an interrupted HTML comment as an empty body", () => {
    expect(reasoningHeading("**Assessing search behavior**\n\n<!--")).toEqual({
      title: "Assessing search behavior",
      body: "",
    })
  })

  test("preserves reasoning after an interrupted HTML comment", () => {
    expect(
      reasoningHeading("**Assessing search behavior**\n\n<!--\nActually reconsider the alternate endpoint."),
    ).toEqual({
      title: "Assessing search behavior",
      body: "Actually reconsider the alternate endpoint.",
    })
  })

  test("treats a titleless placeholder comment as empty", () => {
    expect(reasoningHeading("<!-- -->")).toEqual({ body: "" })
  })

  test("cuts a summary at the first sentence", () => {
    expect(reasoningSummary("Inspect the query. Then compare the results.")).toBe("Inspect the query.")
  })

  test("truncates a long summary at a word boundary", () => {
    const text =
      "This is a deliberately long reasoning summary that should stop cleanly at the last complete word before the limit"
    expect(reasoningSummary(text)).toBe(
      "This is a deliberately long reasoning summary that should stop cleanly at the last…",
    )
  })

  test("strips markdown from a summary", () => {
    expect(reasoningSummary("Review **the `query`** before continuing.")).toBe("Review the query before continuing.")
  })
})
