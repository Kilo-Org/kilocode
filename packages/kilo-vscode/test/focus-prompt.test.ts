import { describe, expect, it } from "bun:test"
import { promptFocusAllowed } from "../webview-ui/src/utils/focus"

const free = {
  force: false,
  deferToQuestion: false,
  questionOption: false,
  ownsRegion: false,
  popup: false,
  textControl: false,
  selection: false,
}

describe("promptFocusAllowed", () => {
  it("focuses an idle prompt", () => {
    expect(promptFocusAllowed(free)).toBe(true)
  })

  it("keeps an open dialog, popup, text control or selection in control", () => {
    expect(promptFocusAllowed({ ...free, textControl: true })).toBe(false)
    expect(promptFocusAllowed({ ...free, popup: true })).toBe(false)
    expect(promptFocusAllowed({ ...free, selection: true })).toBe(false)
  })

  it("keeps focus in a keyboard focus region unless forced", () => {
    expect(promptFocusAllowed({ ...free, ownsRegion: true })).toBe(false)
    expect(promptFocusAllowed({ ...free, ownsRegion: true, force: true })).toBe(true)
  })

  it("force does not take focus from another text control", () => {
    expect(promptFocusAllowed({ ...free, textControl: true, force: true })).toBe(false)
  })

  it("leaves focus with a pending question that has an enabled option", () => {
    expect(promptFocusAllowed({ ...free, deferToQuestion: true, questionOption: true })).toBe(false)
    expect(promptFocusAllowed({ ...free, deferToQuestion: true, questionOption: false })).toBe(true)
    expect(promptFocusAllowed({ ...free, questionOption: true })).toBe(true)
  })
})
