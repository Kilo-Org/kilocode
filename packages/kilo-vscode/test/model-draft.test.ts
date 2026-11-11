// The composer's model draft of a session, as the TUI session draft: Shift+Tab and picks change it at once, the next
// prompt commits it, and the session reporting the same model drops it.
import { describe, expect, test } from "bun:test"
import type { ModelRef } from "@opencode/client"
import { createModelDrafts } from "../webview-ui/src/v2/model-draft"

const model = (variant?: string): ModelRef => ({ providerID: "kilo", id: "claude", ...(variant ? { variant } : {}) })

describe("model drafts", () => {
  test("every press of a fast burst lands without waiting for the server", () => {
    const drafts = createModelDrafts()
    const stored = model("low")
    drafts.set("ses_one", model("medium"), stored)
    drafts.set("ses_one", model("high"), stored)
    drafts.set("ses_one", model(), stored)

    expect(drafts.get("ses_one")).toEqual(model())
  })

  test("a choice equal to the session's own model leaves no draft", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"), model("low"))
    drafts.set("ses_one", model("low"), model("low"))
    expect(drafts.get("ses_one")).toBeUndefined()

    // The server reports no explicit variant as "default".
    drafts.set("ses_one", model(), model("default"))
    expect(drafts.get("ses_one")).toBeUndefined()
  })

  test("a Default choice replaces an earlier effort instead of keeping it", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"), model("low"))
    drafts.set("ses_one", model(), model("low"))

    expect(drafts.get("ses_one")?.variant).toBeUndefined()
  })

  test("the session reporting the committed model drops the draft", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"), model("low"))

    drafts.settle("ses_one", model("low"))
    expect(drafts.get("ses_one")).toEqual(model("high"))
    drafts.settle("ses_one", model("high"))
    expect(drafts.get("ses_one")).toBeUndefined()
  })

  test("a choice made after a send survives the echo of that send", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"), model("low"))
    // The prompt committed high; the user moves on before its echo arrives.
    drafts.set("ses_one", model(), model("low"))

    drafts.settle("ses_one", model("high"))
    expect(drafts.get("ses_one")).toEqual(model())
  })

  test("keeps each session's draft separate", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"), model("low"))

    drafts.settle("ses_two", model("high"))
    expect(drafts.get("ses_one")).toEqual(model("high"))
    expect(drafts.get("ses_two")).toBeUndefined()
  })
})
