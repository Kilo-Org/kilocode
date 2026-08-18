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

    expect(calls.at(-1)).toEqual(["ses_1"])
  })

  test("flush registers empty when the panel is hidden", () => {
    const { calls, presence, setVisible } = setup(true)
    presence.setDisplayed("ses_1")

    setVisible(false)
    presence.flush()

    expect(calls.at(-1)).toEqual([])
  })

  test("flush clears attached when the panel is hidden", () => {
    const { attached, presence, setVisible } = setup(true)
    presence.handle({ type: "agentManager.openSessions", sessionIDs: ["ses_1", "ses_2"] })

    setVisible(false)
    presence.flush()

    expect(attached.at(-1)).toEqual([])
  })

  test("flush re-registers attached when the panel becomes visible again", () => {
    const { attached, presence, setVisible } = setup(true)
    presence.handle({ type: "agentManager.openSessions", sessionIDs: ["ses_1", "ses_2"] })

    setVisible(false)
    presence.flush()
    setVisible(true)
    presence.flush()

    expect(attached.at(-1)).toEqual(["ses_1", "ses_2"])
  })

  test("setDisplayed(null) registers empty even while visible", () => {
    const { calls, presence } = setup(true)
    presence.setDisplayed("ses_1")

    presence.setDisplayed(null)

    expect(calls.at(-1)).toEqual([])
  })

  test("flush after visibility returns re-registers the retained id", () => {
    const { calls, presence, setVisible } = setup(false)
    presence.setDisplayed("ses_1")
    expect(calls.at(-1)).toEqual([])

    setVisible(true)
    presence.flush()

    expect(calls.at(-1)).toEqual(["ses_1"])
  })

  test("setDisplayed(null) prevents a stale id from re-registering on a later flush", () => {
    const { calls, presence, setVisible } = setup(true)
    presence.setDisplayed("ses_1")

    setVisible(false)
    presence.setDisplayed(null)
    setVisible(true)
    presence.flush()

    expect(calls.at(-1)).toEqual([])
  })

  test("handle routes openSessions to attached and visibleSession to visible", () => {
    const { calls, attached, presence } = setup(true)

    presence.handle({ type: "agentManager.openSessions", sessionIDs: ["ses_1", "ses_2"] })
    presence.handle({ type: "agentManager.visibleSession", sessionID: "ses_1" })

    expect(attached.at(-1)).toEqual(["ses_1", "ses_2"])
    expect(calls.at(-1)).toEqual(["ses_1"])
  })

  test("handle while hidden stores state but registers empty", () => {
    const { calls, attached, presence, setVisible } = setup(false)

    presence.handle({ type: "agentManager.openSessions", sessionIDs: ["ses_1"] })
    presence.handle({ type: "agentManager.visibleSession", sessionID: "ses_1" })

    expect(calls.at(-1)).toEqual([])
    expect(attached.at(-1)).toEqual([])

    setVisible(true)
    presence.flush()

    expect(calls.at(-1)).toEqual(["ses_1"])
    expect(attached.at(-1)).toEqual(["ses_1"])
  })

  test("clear empties both the visible and attached registrations", () => {
    const { calls, attached, presence } = setup(true)
    presence.setDisplayed("ses_1")
    presence.handle({ type: "agentManager.openSessions", sessionIDs: ["ses_1"] })

    presence.clear()

    expect(calls.at(-1)).toEqual([])
    expect(attached.at(-1)).toEqual([])
  })
})
