import { describe, expect, test } from "bun:test"
import { reasoningHeading } from "./reasoning-heading"

describe("reasoning heading", () => {
  test("promotes a leading strong line into the title", () => {
    expect(reasoningHeading("**Counting distinct users**\n\nI should aggregate the fixed version first.")).toEqual({
      title: "Counting distinct users",
      body: "I should aggregate the fixed version first.",
    })
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
})
