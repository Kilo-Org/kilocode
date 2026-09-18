import { describe, expect, it } from "bun:test"
import { injectedMetadata, injectedPreview, injectedView, partInjected } from "../../src/shared/injected-prompt"
import { PUSH_INSTRUCTION } from "../../src/shared/review-comments"

describe("injected prompt metadata", () => {
  it("round-trips the title", () => {
    expect(partInjected(injectedMetadata("Update from main"))).toEqual({ title: "Update from main" })
  })

  it("ignores missing or malformed metadata", () => {
    expect(partInjected(undefined)).toBeUndefined()
    expect(partInjected({ kilo: { review: {} } })).toBeUndefined()
    expect(partInjected({ kilo: { injected: { title: "  " } } })).toBeUndefined()
    expect(partInjected({ kilo: { injected: "x" } })).toBeUndefined()
  })

  it("previews only long prompts with their first paragraph", () => {
    expect(injectedPreview("one\ntwo\nthree\nfour")).toBeUndefined()
    expect(injectedPreview("First paragraph.\n\nSecond.\nThird.\nFourth.\nFifth.")).toBe("First paragraph.")
  })
})

describe("injectedView", () => {
  it("labels marked prompts and collapses long ones", () => {
    const long = "Update the branch.\n\nFetch.\nMerge.\nTest.\nPush."
    expect(injectedView(injectedMetadata("Update from main"), long)).toEqual({
      label: "Sent by Kilo \u00B7 Update from main",
      preview: "Update the branch.",
    })
    expect(injectedView(injectedMetadata("/init"), "short")).toEqual({ label: "Sent by Kilo \u00B7 /init" })
  })

  it("labels an auto-sent pull request fix as sent by Kilo", () => {
    expect(injectedView(undefined, PUSH_INSTRUCTION)).toEqual({
      label: "Sent by Kilo \u00B7 Fix pull request feedback",
    })
  })

  it("shows the user's text and hides the added push instruction until expanded", () => {
    expect(injectedView(undefined, `${PUSH_INSTRUCTION}\n\nPlease also rename the helper.`)).toEqual({
      label: "Kilo added: push fixes to the pull request",
      preview: "Please also rename the helper.",
    })
  })

  it("returns undefined for a plain user message", () => {
    expect(injectedView(undefined, "hello")).toBeUndefined()
    expect(injectedView({ kilo: { review: {} } }, "Do not force-push.")).toBeUndefined()
  })
})
