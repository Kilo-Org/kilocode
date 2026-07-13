import { describe, expect, test } from "bun:test"
import { AgentManagerVisiblePresence } from "./am-visible-presence"

function setup(initialVisible = true) {
  const calls: string[][] = []
  const attached: string[][] = []
  let visible = initialVisible
  const presence = new AgentManagerVisiblePresence(
    (ids) => calls.push(ids),
    () => visible,
    (ids) => attached.push(ids),
  )
  return {
    calls,
    attached,
    presence,
    setVisible(value: boolean) {
      visible = value
    },
  }
}

describe("AgentManagerVisiblePresence", () => {
  test("registers the displayed id while the panel is visible", () => {
    const { calls, presence } = setup(true)

    presence.setDisplayed("ses_1")

    expect(calls).toEqual([["ses_1"]])
  })

  test("flush registers empty when the panel is hidden", () => {
    const { calls, presence, setVisible } = setup(true)
    presence.setDisplayed("ses_1")

    setVisible(false)
    presence.flush()

    expect(calls).toEqual([["ses_1"], []])
  })

  test("setDisplayed(null) registers empty even while visible", () => {
    const { calls, presence } = setup(true)
    presence.setDisplayed("ses_1")

    presence.setDisplayed(null)

    expect(calls).toEqual([["ses_1"], []])
  })

  test("flush after visibility returns re-registers the retained id", () => {
    const { calls, presence, setVisible } = setup(false)
    presence.setDisplayed("ses_1")
    expect(calls).toEqual([[]])

    setVisible(true)
    presence.flush()

    expect(calls).toEqual([[], ["ses_1"]])
  })

  // Provider cleanup contract: panel dispose / disposeAsync must clear the
  // displayed id via setDisplayed(null) — not by calling registerVisible
  // directly — so a stale id cannot re-register on a later flush (e.g. the
  // visibility flush of a reopened panel before the webview reports its tab).
  test("setDisplayed(null) prevents a stale id from re-registering on a later flush", () => {
    const { calls, presence, setVisible } = setup(true)
    presence.setDisplayed("ses_1")

    setVisible(false)
    presence.setDisplayed(null)
    setVisible(true)
    presence.flush()

    expect(calls).toEqual([["ses_1"], [], []])
  })

  test("handle routes openSessions to attached and visibleSession to visible", () => {
    const { calls, attached, presence } = setup(true)

    presence.handle({ type: "agentManager.openSessions", sessionIDs: ["ses_1", "ses_2"] })
    presence.handle({ type: "agentManager.visibleSession", sessionID: "ses_1" })

    expect(attached).toEqual([["ses_1", "ses_2"]])
    expect(calls).toEqual([["ses_1"]])
  })

  test("clear empties both the visible and attached registrations", () => {
    const { calls, attached, presence } = setup(true)
    presence.setDisplayed("ses_1")
    presence.handle({ type: "agentManager.openSessions", sessionIDs: ["ses_1"] })

    presence.clear()

    expect(calls).toEqual([["ses_1"], []])
    expect(attached).toEqual([["ses_1"], []])
  })
})
