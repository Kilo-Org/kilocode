import { describe, expect, it } from "bun:test"
import { createCloudSessionState } from "../../webview-ui/agent-manager/cloud-agent/session-state"
import type { SessionInfo, WebviewMessage } from "../../webview-ui/src/types/messages"

const info = (id: string, title = id, updatedAt = "2026-06-03T00:00:00.000Z"): SessionInfo => ({
  id,
  title,
  createdAt: "2026-06-03T00:00:00.000Z",
  updatedAt,
})

function createState(enabled = true) {
  const sent: WebviewMessage[] = []
  const attached: SessionInfo[] = []
  const detached: string[] = []
  const selected: string[] = []
  const contexts: string[] = []
  let current: string | undefined
  let cleared = 0
  let sessions: SessionInfo[] = []
  const state = createCloudSessionState({
    enabled,
    session: {
      currentSessionID: () => current,
      sessions: () => sessions,
      selectSession: (id) => {
        current = id
        selected.push(id)
      },
      clearCurrentSession: () => {
        current = undefined
        cleared++
      },
      attachCloudSession: (session) => {
        sessions = [...sessions.filter((item) => item.id !== session.id), session]
        attached.push(session)
      },
      detachCloudSession: (id) => {
        current = current === id ? undefined : current
        sessions = sessions.filter((item) => item.id !== id)
        detached.push(id)
      },
    },
    postMessage: (message) => sent.push(message),
    setSelection: (selection) => contexts.push(selection),
    prepare: () => {},
  })
  if (enabled) {
    state.enable(true)
    sent.length = 0
  }
  return {
    state,
    sent,
    attached,
    detached,
    selected,
    contexts,
    current: () => current,
    cleared: () => cleared,
    stream: (session: SessionInfo) => {
      sessions = [...sessions.filter((item) => item.id !== session.id), session]
    },
  }
}

describe("cloud session state", () => {
  it("opens an attached session once while allowing it to be focused again", () => {
    const ctl = createState()
    const session = info("ses_a")

    ctl.state.open(session)
    ctl.state.open(session)

    expect(ctl.state.ids()).toEqual(["ses_a"])
    expect(ctl.sent).toEqual([{ type: "agentManager.openCloudSession", sessionId: "ses_a" }])
    expect(ctl.current()).toBe("ses_a")
  })

  it("closes an inactive attached session without changing the active session", () => {
    const ctl = createState()
    ctl.state.open(info("ses_a"))
    ctl.state.open(info("ses_b"))

    ctl.state.close("ses_a")

    expect(ctl.state.ids()).toEqual(["ses_b"])
    expect(ctl.current()).toBe("ses_b")
    expect(ctl.selected).toEqual(["ses_a", "ses_b"])
  })

  it("selects the adjacent attached session when the active session closes", () => {
    const ctl = createState()
    ctl.state.open(info("ses_a"))
    ctl.state.open(info("ses_b"))
    ctl.state.open(info("ses_c"))
    ctl.state.open(info("ses_b"))

    ctl.state.close("ses_b")

    expect(ctl.state.ids()).toEqual(["ses_a", "ses_c"])
    expect(ctl.current()).toBe("ses_c")
    expect(ctl.selected.at(-1)).toBe("ses_c")
  })

  it("falls back to LOCAL when the last active session closes", () => {
    const ctl = createState()
    ctl.state.open(info("ses_a"))

    ctl.state.close("ses_a")

    expect(ctl.contexts.at(-1)).toBe("local")
    expect(ctl.cleared()).toBe(1)
  })

  it("closes an attached session when the extension reports remote deletion", () => {
    const ctl = createState()
    ctl.state.open(info("ses_a"))

    ctl.state.handle({ type: "agentManager.cloudSessionDeleted", sessionId: "ses_a" })

    expect(ctl.state.ids()).toEqual([])
    expect(ctl.detached).toEqual(["ses_a"])
    expect(ctl.sent).toEqual([
      { type: "agentManager.openCloudSession", sessionId: "ses_a" },
      { type: "agentManager.closeCloudSession", sessionId: "ses_a" },
    ])
  })

  it("uses a distinct request for explicit retry", () => {
    const ctl = createState()

    ctl.state.request()
    ctl.state.retry()

    expect(ctl.sent).toEqual([
      { type: "agentManager.requestCloudSessions" },
      { type: "agentManager.retryCloudSessions" },
    ])
  })

  it("requests discovery only after the experimental feature is enabled", () => {
    const ctl = createState(false)
    const session = info("ses_hidden")

    ctl.state.handle({ type: "agentManager.cloudSessions", status: "ready", sessions: [session] })
    expect(ctl.state.sessions()).toEqual([])
    expect(ctl.sent).toEqual([])

    ctl.state.enable(true)
    ctl.state.handle({ type: "agentManager.cloudSessions", status: "ready", sessions: [session] })

    expect(ctl.sent).toEqual([{ type: "agentManager.requestCloudSessions" }])
    expect(ctl.state.sessions()).toEqual([session])
  })

  it("closes the dialog and detaches every open session when the feature is disabled", () => {
    const ctl = createState()
    ctl.state.open(info("ses_a"))
    ctl.state.open(info("ses_b"))
    let closed = 0

    ctl.state.enable(false, () => closed++)

    expect(closed).toBe(1)
    expect(ctl.state.enabled()).toBe(false)
    expect(ctl.state.ids()).toEqual([])
    expect(ctl.state.sessions()).toEqual([])
    expect(ctl.detached).toEqual(["ses_a", "ses_b"])
    expect(ctl.contexts.at(-1)).toBe("local")
    expect(ctl.sent.slice(-2)).toEqual([
      { type: "agentManager.closeCloudSession", sessionId: "ses_a" },
      { type: "agentManager.closeCloudSession", sessionId: "ses_b" },
    ])
  })

  it("retains discovery rows while loading and after a retryable error", () => {
    const ctl = createState()
    const session = info("ses_listed")

    ctl.state.handle({ type: "agentManager.cloudSessions", status: "ready", sessions: [session] })
    ctl.state.handle({ type: "agentManager.cloudSessions", status: "loading", sessions: [session] })

    expect(ctl.state.status()).toBe("loading")
    expect(ctl.state.sessions()).toEqual([session])

    ctl.state.handle({ type: "agentManager.cloudSessions", status: "error", sessions: [session], error: "offline" })

    expect(ctl.state.status()).toBe("error")
    expect(ctl.state.sessions()).toEqual([session])
    expect(ctl.state.error()).toBe("offline")
  })

  it("updates only an existing Cloud discovery row from session metadata", () => {
    const ctl = createState()
    const listed = info("ses_cloud", "Listed", "2026-06-03T00:01:00.000Z")
    const live = info("ses_cloud", "Generated", "2026-06-03T00:02:00.000Z")

    ctl.state.handle({ type: "agentManager.cloudSessions", status: "ready", sessions: [listed] })
    ctl.state.handle({ type: "sessionUpdated", session: live })
    ctl.state.handle({ type: "sessionUpdated", session: info("ses_local", "Local", live.updatedAt) })

    expect(ctl.state.sessions()).toEqual([live])
  })

  it("rejects stale session metadata and accepts a changed equal-version title", () => {
    const ctl = createState()
    const current = info("ses_cloud", "Current", "2026-06-03T00:02:00.000Z")

    ctl.state.handle({ type: "agentManager.cloudSessions", status: "ready", sessions: [current] })
    ctl.state.handle({
      type: "sessionUpdated",
      session: info("ses_cloud", "Older", "2026-06-03T00:01:00.000Z"),
    })
    expect(ctl.state.sessions()).toEqual([current])

    const equal = info("ses_cloud", "Equal live", current.updatedAt)
    ctl.state.handle({ type: "sessionUpdated", session: equal })
    expect(ctl.state.sessions()).toEqual([equal])
  })

  it("distinguishes equal-version list rows from observed metadata", () => {
    const ctl = createState()
    const first = info("ses_cloud", "First list title", "2026-06-03T00:01:00.000Z")
    const second = info("ses_cloud", "Second list title", first.updatedAt)

    ctl.state.handle({ type: "agentManager.cloudSessions", status: "ready", sessions: [first] })
    ctl.state.handle({ type: "agentManager.cloudSessions", status: "ready", sessions: [second] })
    expect(ctl.state.sessions()).toEqual([second])

    const live = info("ses_cloud", "Live title", first.updatedAt)
    ctl.state.handle({ type: "sessionUpdated", session: live })
    ctl.state.handle({ type: "agentManager.cloudSessions", status: "ready", sessions: [second] })
    expect(ctl.state.sessions()).toEqual([live])
  })

  it("keeps observed titles while incoming discovery controls membership and order", () => {
    const ctl = createState()
    const live = info("ses_a", "Live A", "2026-06-03T00:02:00.000Z")
    ctl.state.handle({
      type: "agentManager.cloudSessions",
      status: "ready",
      sessions: [info("ses_a", "Listed A", "2026-06-03T00:01:00.000Z"), info("ses_removed")],
    })
    ctl.state.handle({ type: "sessionUpdated", session: live })

    ctl.state.handle({
      type: "agentManager.cloudSessions",
      status: "ready",
      sessions: [
        info("ses_b", "Listed B", "2026-06-03T00:03:00.000Z"),
        info("ses_a", "Stale A", "2026-06-03T00:01:00.000Z"),
      ],
    })

    expect(ctl.state.sessions()).toEqual([info("ses_b", "Listed B", "2026-06-03T00:03:00.000Z"), live])
  })

  it("tracks the exact repository name used for discovery", () => {
    const ctl = createState()

    ctl.state.handle({
      type: "agentManager.cloudSessions",
      status: "ready",
      sessions: [],
      repository: "Kilo-Org/kilocode",
    })

    expect(ctl.state.repository()).toBe("Kilo-Org/kilocode")

    ctl.state.handle({ type: "agentManager.cloudSessions", status: "ready", sessions: [] })

    expect(ctl.state.repository()).toBeUndefined()
  })

  it("tracks signed-out discovery without exposing stale rows as visible", () => {
    const ctl = createState()
    const session = info("ses_listed")

    ctl.state.handle({ type: "agentManager.cloudSessions", status: "ready", sessions: [session] })
    ctl.state.handle({ type: "agentManager.cloudSessions", status: "signed-out", sessions: [session] })

    expect(ctl.state.status()).toBe("signed-out")
    expect(ctl.state.sessions()).toEqual([session])
    expect(ctl.state.visible()).toEqual([])
  })

  it("preserves an attached tab absent from a capped discovery refresh", () => {
    const ctl = createState()
    ctl.state.open(info("ses_attached", "old"))

    ctl.state.handle({ type: "agentManager.cloudSessions", status: "ready", sessions: [info("ses_listed")] })

    expect(ctl.state.ids()).toEqual(["ses_attached"])
    expect(ctl.state.tabs()).toEqual([info("ses_attached", "old")])
    expect(ctl.detached).toEqual([])
  })

  it("refreshes an attached tab summary when it appears in discovery", () => {
    const ctl = createState()
    ctl.state.open(info("ses_attached", "old"))

    ctl.state.handle({ type: "agentManager.cloudSessions", status: "ready", sessions: [info("ses_attached", "new")] })

    expect(ctl.state.tabs()).toEqual([info("ses_attached", "new")])
    expect(ctl.attached.at(-1)).toEqual(info("ses_attached", "new"))
  })

  it("reflects canonical streamed summary changes in attached tabs", () => {
    const ctl = createState()
    ctl.state.open(info("ses_attached", "old"))

    ctl.stream(info("ses_attached", "streamed"))

    expect(ctl.state.tabs()).toEqual([info("ses_attached", "streamed")])
  })

  it("requests sanitized create context separately from discovery", () => {
    const ctl = createState()

    ctl.state.requestCreateContext()

    expect(ctl.sent).toEqual([{ type: "agentManager.requestCloudCreateContext" }])
  })

  it("clears the previous create error when a reopened dialog requests fresh context", () => {
    const ctl = createState()
    ctl.state.handle({ type: "agentManager.cloudSessionCreateFailed", kind: "rejected", error: "Try again." })

    ctl.state.requestCreateContext()

    expect(ctl.state.context()).toEqual({ status: "loading" })
    expect(ctl.state.createError()).toBeUndefined()
  })

  it("submits only prompt, mode, and model while tracking in-flight creation", () => {
    const ctl = createState()

    ctl.state.create({ prompt: "Fix the bug", mode: "code", model: "kilo-auto" })

    expect(ctl.state.creating()).toBeTrue()
    expect(ctl.sent).toEqual([
      { type: "agentManager.createCloudSession", prompt: "Fix the bug", mode: "code", model: "kilo-auto" },
    ])
  })

  it("opens a created session through the idempotent handoff path and signals success", () => {
    const ctl = createState()
    const created = info("ses_created", "Starting cloud session")

    ctl.state.create({ prompt: "Fix the bug", mode: "code", model: "kilo-auto" })
    ctl.state.handle({ type: "agentManager.cloudSessionCreated", session: created })

    expect(ctl.state.creating()).toBeFalse()
    expect(ctl.state.success()).toBe(1)
    expect(ctl.state.ids()).toEqual(["ses_created"])
    expect(ctl.current()).toBe("ses_created")
    expect(ctl.sent).toEqual([
      { type: "agentManager.createCloudSession", prompt: "Fix the bug", mode: "code", model: "kilo-auto" },
      { type: "agentManager.openCloudSession", sessionId: "ses_created" },
    ])
  })

  it("preserves sanitized create context and exposes distinct host failures", () => {
    const ctl = createState()

    ctl.state.handle({
      type: "agentManager.cloudCreateContext",
      status: "ready",
      repository: "github.com/Kilo-Org/kilocode",
      account: "Kilo Org",
    })
    ctl.state.create({ prompt: "Fix the bug", mode: "code", model: "kilo-auto" })
    ctl.state.handle({
      type: "agentManager.cloudSessionCreateFailed",
      kind: "indeterminate",
      error: "Check Cloud Agents.",
    })

    expect(ctl.state.context()).toEqual({
      status: "ready",
      repository: "github.com/Kilo-Org/kilocode",
      account: "Kilo Org",
      error: undefined,
    })
    expect(ctl.state.creating()).toBeFalse()
    expect(ctl.state.createError()).toBe("Check Cloud Agents.")
    expect(ctl.state.success()).toBe(0)
  })
})
