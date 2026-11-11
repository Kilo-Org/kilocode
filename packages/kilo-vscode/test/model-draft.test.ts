// The composer's model draft of a session, as the TUI session draft: Shift+Tab and picks change it at once, the next
// prompt commits it, and the session reporting the same model drops it.
import { describe, expect, test } from "bun:test"
import type { ModelRef } from "@opencode/client"
import { createModelDrafts } from "../webview-ui/src/v2/model-draft"

const model = (variant?: string): ModelRef => ({ providerID: "kilo", id: "claude", ...(variant ? { variant } : {}) })

describe("model drafts", () => {
  test("every press of a fast burst lands without waiting for the server", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("medium"), model("low"))
    drafts.set("ses_one", model("high"), model("low"))
    drafts.set("ses_one", model(), model("low"))

    expect(drafts.get("ses_one")).toEqual(model())
  })

  test("a Default pick replaces an earlier effort instead of keeping it", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"), model("low"))
    drafts.set("ses_one", model(), model("low"))

    expect(drafts.get("ses_one")).toEqual(model())
  })

  test("a pick equal to the session's own model leaves no draft", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("low"), model("low"))

    expect(drafts.get("ses_one")).toBeUndefined()
  })

  test("a pick equal to the stored model during a commit is kept until the echo", () => {
    // The store reports low, the draft is high and its commit is in flight; the user cycles back to low.
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"), model("low"))
    drafts.commit("ses_one", model("high"))
    drafts.set("ses_one", model("low"), model("low"))

    drafts.settle("ses_one", model("high"))
    expect(drafts.get("ses_one")).toEqual(model("low"))
  })

  test("the echo of the committed model ends the commit and drops the draft", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"), model("low"))
    drafts.commit("ses_one", model("high"))

    drafts.settle("ses_one", model("high"))
    expect(drafts.get("ses_one")).toBeUndefined()

    // An equal pick is no longer a change back from a pending commit.
    drafts.set("ses_one", model("high"), model("high"))
    expect(drafts.get("ses_one")).toBeUndefined()
  })

  test("a failed commit stops blocking an equal pick", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"), model("low"))
    drafts.commit("ses_one", model("high"))
    drafts.failed("ses_one", model("high"))

    drafts.set("ses_one", model("low"), model("low"))
    expect(drafts.get("ses_one")).toBeUndefined()
  })

  test("a commit the server ignores ends once the session already reports its model", () => {
    // The session already runs on high, so switchModel is a no-op and emits no echo.
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"), model("low"))
    drafts.commit("ses_one", model("high"))
    drafts.committed("ses_one", model("high"))

    drafts.set("ses_one", model("high"), model("high"))
    expect(drafts.get("ses_one")).toBeUndefined()
  })

  test("a commit whose echo has not arrived keeps the wait", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"), model("low"))
    drafts.commit("ses_one", model("high"))
    // The store still reports the model before the commit, so the echo is still coming.
    drafts.committed("ses_one", model("low"))

    drafts.set("ses_one", model("low"), model("low"))
    expect(drafts.get("ses_one")).toEqual(model("low"))
  })

  test("a deleted session drops its draft", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"), model("low"))

    drafts.drop("ses_one")
    expect(drafts.get("ses_one")).toBeUndefined()
  })

  test("keeps each session's draft separate", () => {
    const drafts = createModelDrafts()
    drafts.set("ses_one", model("high"), model("low"))

    drafts.settle("ses_two", model("high"))
    expect(drafts.get("ses_one")).toEqual(model("high"))
    expect(drafts.get("ses_two")).toBeUndefined()
  })
})
