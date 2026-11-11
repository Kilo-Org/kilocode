// The composer's model draft of a session, as the TUI session draft: Shift+Tab and picks change it at once, the next
// prompt commits it, and the session reporting the same model drops it.
import { describe, expect, test } from "bun:test"
import type { ModelRef } from "@opencode/client"
import { createModelDrafts } from "../webview-ui/src/v2/model-draft"

const model = (variant?: string): ModelRef => ({ providerID: "kilo", id: "claude", ...(variant ? { variant } : {}) })

describe("model drafts", () => {
  test("every press of a fast burst lands without waiting for the server", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("medium"))
    drafts.set("ses_one", model("high"))
    drafts.set("ses_one", model())

    expect(drafts.get("ses_one")).toEqual(model())
  })

  test("a Default pick replaces an earlier effort instead of keeping it", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"))
    drafts.set("ses_one", model())

    expect(drafts.get("ses_one")).toEqual(model())
  })

  test("a pick equal to the stored model is kept until the session reports it", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("low"))

    expect(drafts.get("ses_one")).toEqual(model("low"))
  })

  test("the session reporting the committed model drops the draft", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"))

    drafts.settle("ses_one", model("low"))
    expect(drafts.get("ses_one")).toEqual(model("high"))
    drafts.settle("ses_one", model("high"))
    expect(drafts.get("ses_one")).toBeUndefined()
  })

  test("a choice made after a send survives the echo of that send", () => {
    // The store reports low, the draft is high and its commit is in flight; the user cycles back to low.
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"))
    drafts.set("ses_one", model("low"))

    drafts.settle("ses_one", model("high"))
    expect(drafts.get("ses_one")).toEqual(model("low"))
  })

  test("an echo that matches the draft drops it after a change back to the stored model", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"))
    drafts.set("ses_one", model("low"))
    drafts.settle("ses_one", model("high"))

    drafts.settle("ses_one", model("low"))
    expect(drafts.get("ses_one")).toBeUndefined()
  })

  test("a deleted session drops its draft", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"))

    drafts.drop("ses_one")
    expect(drafts.get("ses_one")).toBeUndefined()
  })

  test("keeps each session's draft separate", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"))

    drafts.settle("ses_two", model("high"))
    expect(drafts.get("ses_one")).toEqual(model("high"))
    expect(drafts.get("ses_two")).toBeUndefined()
  })
})
