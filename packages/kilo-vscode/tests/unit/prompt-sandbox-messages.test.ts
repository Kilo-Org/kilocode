import { describe, expect, it } from "bun:test"
import { sandboxMessages } from "../../webview-ui/src/components/chat/prompt-sandbox-messages"
import type { SandboxDefaultState, SandboxState } from "../../webview-ui/src/components/chat/prompt-input-utils"
import type {
  SandboxDefaultStatusMessage,
  SandboxStatusMessage,
  SandboxStatusErrorMessage,
} from "../../webview-ui/src/types/messages"

const preference: SandboxDefaultState = {
  desired: true,
  enabled: true,
  available: true,
  reason: undefined,
  revision: 3,
}
const defaults: SandboxDefaultStatusMessage = { type: "sandboxDefaultStatus", ...preference }
const status: SandboxStatusMessage = {
  type: "sandboxStatus",
  sessionID: "ses_1",
  directory: "/repo",
  enabled: true,
  available: true,
  version: 2,
  revision: 3,
}
const failure: SandboxStatusErrorMessage = {
  type: "sandboxStatusError",
  sessionID: "ses_1",
  directory: "/repo",
  message: "Sandbox unavailable",
  revision: 3,
}

function setup(
  input: {
    connected?: boolean
    session?: string
    defaults?: SandboxDefaultState
    states?: Record<string, SandboxState>
    requests?: Record<string, string>
  } = {},
) {
  const state = {
    ...input,
    connected: input.connected ?? true,
    states: input.states ?? {},
    requests: input.requests ?? {},
  }
  const calls: unknown[][] = []
  const handle = sandboxMessages({
    connected: () => state.connected,
    session: () => state.session,
    pending: (id) => state.requests[id ?? ""],
    clear: (id, request) => calls.push(["clear", id, request]),
    defaults: () => state.defaults,
    setDefault: (value) => {
      state.defaults = value
      calls.push(["default"])
    },
    states: () => state.states,
    setStates: (value) => {
      state.states = value
      calls.push(["states"])
    },
    reset: () => calls.push(["reset"]),
    retry: (id) => calls.push(["retry", id]),
    refresh: () => calls.push(["refresh"]),
    error: (reason) => calls.push(["error", reason]),
  })
  return { state, calls, handle }
}

describe("sandboxMessages", () => {
  it("dispatches config updates and leaves unrelated messages unhandled", () => {
    const fixture = setup({ connected: false })
    expect(fixture.handle({ type: "configUpdated", config: {} })).toBe(true)
    expect(fixture.handle({ type: "autoApproveState", active: true })).toBe(false)
    expect(fixture.calls).toEqual([["refresh"]])
  })

  it.each([defaults, status, failure])("ignores $type responses while disconnected", (message) => {
    const fixture = setup({ connected: false, requests: { "": "request", ses_1: "request" } })
    const states = fixture.state.states
    expect(fixture.handle({ ...message, requestID: "request" })).toBe(true)
    expect(fixture.state.states).toBe(states)
    expect(fixture.state.defaults).toBeUndefined()
    expect(fixture.calls).toEqual([])
  })

  it.each([undefined, "unmatched"])("loads defaults for a draft with request ID %s", (requestID) => {
    const fixture = setup({ requests: { "": "pending" } })
    expect(fixture.handle({ ...defaults, requestID })).toBe(true)
    expect(fixture.state.defaults).toEqual(preference)
    expect(fixture.calls).toEqual([["default"]])
  })

  it.each([true, false])("leaves unmatched defaults unhandled in a session when connected is %s", (connected) => {
    const fixture = setup({ session: "ses_1", connected, requests: { "": "pending" } })
    expect(fixture.handle({ ...defaults, requestID: "unmatched" })).toBe(false)
    expect(fixture.state.defaults).toBeUndefined()
    expect(fixture.calls).toEqual([])
  })

  it("handles a matching default response after switching to a session", () => {
    const fixture = setup({ requests: { "": "request" } })
    fixture.state.session = "ses_1"
    expect(fixture.handle({ ...defaults, available: false, reason: "Unavailable", requestID: "request" })).toBe(true)
    expect(fixture.state.defaults).toEqual({ ...preference, available: false, reason: "Unavailable" })
    expect(fixture.calls).toEqual([["clear", undefined, "request"], ["default"], ["error", "Unavailable"]])
  })

  it("keeps newer defaults but still clears and reports a matching stale failure", () => {
    const current = { ...preference, revision: 4 }
    const fixture = setup({ defaults: current, requests: { "": "request" } })
    expect(fixture.handle({ ...defaults, available: false, requestID: "request" })).toBe(true)
    expect(fixture.state.defaults).toBe(current)
    expect(fixture.calls).toEqual([
      ["clear", undefined, "request"],
      ["error", undefined],
    ])
  })

  it("accepts equal default revisions without reporting unmatched unavailability", () => {
    const fixture = setup({ defaults: preference })
    expect(fixture.handle({ ...defaults, desired: false, enabled: false, available: false })).toBe(true)
    expect(fixture.state.defaults).toEqual({ ...preference, desired: false, enabled: false, available: false })
    expect(fixture.calls).toEqual([["default"]])
  })

  it.each([undefined, "unmatched"])("updates session status without clearing request ID %s", (requestID) => {
    const fixture = setup({ session: "ses_1", requests: { ses_1: "pending" } })
    const message = { ...status, available: false, requestID }
    expect(fixture.handle(message)).toBe(true)
    expect(fixture.state.states).toEqual({ ses_1: message })
    expect(fixture.calls).toEqual([["states"], ["reset"]])
  })

  it("clears matching toggles and reports the applied session status", () => {
    const fixture = setup({ session: "ses_1", requests: { ses_1: "request" } })
    const message = { ...status, available: false, reason: "Unavailable", requestID: "request" }
    expect(fixture.handle(message)).toBe(true)
    expect(fixture.state.states).toEqual({ ses_1: message })
    expect(fixture.calls).toEqual([["clear", "ses_1", "request"], ["states"], ["reset"], ["error", "Unavailable"]])
  })

  it("caches other sessions without resetting the active session retry", () => {
    const fixture = setup({ session: "ses_1", states: { ses_1: status }, requests: { ses_2: "request" } })
    const message = { ...status, sessionID: "ses_2", requestID: "request" }
    expect(fixture.handle(message)).toBe(true)
    expect(fixture.state.states).toEqual({ ses_1: status, ses_2: message })
    expect(fixture.calls).toEqual([["clear", "ses_2", "request"], ["states"]])
  })

  it.each([{ revision: 4 }, { version: 3 }])("keeps newer session state ordered by %j", (ordering) => {
    const current = { ...status, ...ordering }
    const fixture = setup({ session: "ses_1", states: { ses_1: current }, requests: { ses_1: "request" } })
    const states = fixture.state.states
    expect(fixture.handle({ ...status, available: false, requestID: "request" })).toBe(true)
    expect(fixture.state.states).toBe(states)
    expect(fixture.calls).toEqual([["clear", "ses_1", "request"], ["reset"]])
  })

  it("reports retained unavailable state rather than a stale status reason", () => {
    const current = { ...status, available: false, reason: "Current failure", revision: 4 }
    const fixture = setup({ states: { ses_1: current }, requests: { ses_1: "request" } })
    expect(fixture.handle({ ...status, requestID: "request" })).toBe(true)
    expect(fixture.state.states.ses_1).toBe(current)
    expect(fixture.calls).toEqual([
      ["clear", "ses_1", "request"],
      ["error", "Current failure"],
    ])
  })

  it("preserves same-directory state on status errors and retries only the active session", () => {
    const fixture = setup({ session: "ses_1", states: { ses_1: status } })
    expect(fixture.handle(failure)).toBe(true)
    expect(fixture.state.states.ses_1).toEqual({
      sessionID: "ses_1",
      directory: "/repo",
      enabled: true,
      available: false,
      reason: failure.message,
      version: 2,
      revision: 3,
    })
    expect(fixture.calls).toEqual([["states"], ["retry", "ses_1"]])
    fixture.calls.length = 0
    fixture.state.session = "ses_2"
    expect(fixture.handle({ ...failure, revision: 4 })).toBe(true)
    expect(fixture.calls).toEqual([["states"]])
  })

  it.each([undefined, { ...status, directory: "/other" }])(
    "resets unknown or different-directory error state %j",
    (current) => {
      const fixture = setup({ states: current ? { ses_1: current } : {} })
      expect(fixture.handle(failure)).toBe(true)
      expect(fixture.state.states.ses_1).toEqual({
        sessionID: "ses_1",
        directory: "/repo",
        enabled: false,
        available: false,
        reason: failure.message,
        version: 0,
        revision: 3,
      })
      expect(fixture.calls).toEqual([["states"]])
    },
  )

  it.each([undefined, "unmatched", "request"])(
    "ignores stale errors with request ID %s after matching cleanup",
    (requestID) => {
      const current = { ...status, revision: 4 }
      const fixture = setup({ session: "ses_1", states: { ses_1: current }, requests: { ses_1: "request" } })
      const states = fixture.state.states
      expect(fixture.handle({ ...failure, requestID })).toBe(true)
      expect(fixture.state.states).toBe(states)
      expect(fixture.calls).toEqual(requestID === "request" ? [["clear", "ses_1", "request"]] : [])
    },
  )

  it.each(["unmatched", "request"])(
    "handles toggle errors with request ID %s without state updates or retry",
    (requestID) => {
      const fixture = setup({ session: "ses_1", states: { ses_1: status }, requests: { ses_1: "request" } })
      const states = fixture.state.states
      expect(fixture.handle({ ...failure, requestID })).toBe(true)
      expect(fixture.state.states).toBe(states)
      expect(fixture.calls).toEqual(
        requestID === "request"
          ? [
              ["clear", "ses_1", "request"],
              ["error", failure.message],
            ]
          : [],
      )
    },
  )
})
