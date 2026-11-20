import { beforeEach, describe, expect, it, test } from "bun:test"
import { savedAutoApprove } from "../../src/kilocode/auto-approve"
import { nextPermissionMode, permissionModeOverride, setPermissionMode } from "../../src/kilocode/permission-mode"
import { createAppFixture } from "../fixture/app"
import { directory, json } from "../fixture/tui-client"

const location = { directory, project: { id: "project", directory, canonical: directory } }

type AutoApproveState = { enabled: boolean }

/** The `kilocode.settings` RPC over the global auto-approve key, with the same in-memory store the TUI reads. */
function settings(state: AutoApproveState) {
  return async (url: URL, request: Request) => {
    if (url.pathname === "/api/rpc/kilocode.settings/read")
      return json({
        output: {
          scope: "global",
          target: { scope: "global", path: `${directory}/kilo2.json`, revision: "rev", exists: true },
          document: state.enabled ? { auto_approve: true } : {},
        },
      })
    if (url.pathname === "/api/rpc/kilocode.settings/write") {
      const body = (await request.clone().json()) as { input?: { set?: { auto_approve?: boolean | null } } }
      state.enabled = body.input?.set?.auto_approve === true
      return json({
        output: {
          scope: "global",
          target: { scope: "global", path: `${directory}/kilo2.json`, revision: "next", exists: true },
          changed: true,
        },
      })
    }
    return undefined
  }
}

function withSession(sessionID: string, state: AutoApproveState) {
  const remote = settings(state)
  const session = sessionFetch(sessionID)
  return async (url: URL, request: Request) => (await remote(url, request)) ?? session(url)
}

function sessionFetch(sessionID: string) {
  return async (url: URL) => {
    if (url.pathname === `/api/session/${sessionID}`)
      return json({
        data: {
          id: sessionID,
          projectID: "project",
          title: "Auto-approve fixture",
          agent: "build",
          model: { providerID: "demo", id: "model" },
          location: { directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
        },
      })
    if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
    if (url.pathname === `/api/session/${sessionID}/inbox`) return json({ data: [] })
    if (url.pathname === "/api/agent")
      return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
    if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
    if (url.pathname === "/api/model")
      return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
    if (url.pathname === `/api/session/${sessionID}/permission`) return json({ data: [] })
    return undefined
  }
}

beforeEach(() => setPermissionMode(undefined))

// Frames advance faster than the SSE round trip, so a frame budget alone can expire before an event arrives.
async function until(
  app: { captureCharFrame: () => string },
  label: string,
  predicate: (frame: string) => boolean,
  timeout = 5000,
) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (predicate(app.captureCharFrame())) return
    await Bun.sleep(50)
  }
  throw new Error(`timed out waiting for ${label}:\n` + app.captureCharFrame())
}

describe("auto-approve mode", () => {
  it("applies the configured mode until it is toggled", () => {
    expect(permissionModeOverride()).toBeUndefined()
  })

  it("toggles from the effective mode", () => {
    expect(nextPermissionMode("prompt")).toBe("autoaccept")
    expect(nextPermissionMode("autoaccept")).toBe("prompt")
  })

  it("degrades an unrecognized mode to prompting", () => {
    expect(nextPermissionMode("future-mode" as Parameters<typeof nextPermissionMode>[0])).toBe("prompt")
  })

  it("falls back to the configured mode when the override is cleared", () => {
    setPermissionMode("autoaccept")
    setPermissionMode(undefined)
    expect(permissionModeOverride()).toBeUndefined()
  })

  it("only lets the global config enable the saved rule, while a project can narrow it", () => {
    expect(savedAutoApprove({ auto_approve: true }, undefined)).toBe(true)
    expect(savedAutoApprove({ auto_approve: true }, { auto_approve: true })).toBe(true)
    expect(savedAutoApprove({}, { auto_approve: true })).toBe(false)
    expect(savedAutoApprove({ auto_approve: true }, { auto_approve: false })).toBe(false)
    expect(savedAutoApprove(undefined, undefined)).toBe(false)
  })
})

test(
  "/auto-approve and Ctrl+Alt+A toggle auto-approve",
  async () => {
    const state: AutoApproveState = { enabled: false }
    await using app = await createAppFixture({ fetch: settings(state) })
    await app.ready
    await app.waitForFrame((frame) => frame.includes("ctrl+p commands"))

    await app.mockInput.typeText("/auto-approve")
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Auto-approve enabled."))
    // The choice is saved globally, so a new client or a new TUI process starts enabled.
    expect(state.enabled).toBe(true)

    app.mockInput.pressKey("a", { ctrl: true, meta: true })
    await app.waitForFrame((frame) => frame.includes("Auto-approve disabled."))
    expect(state.enabled).toBe(false)

    expect(app.captureCharFrame()).not.toContain("Auto-approve enabled.")
  },
  30000,
)

test(
  "keeps auto-approve after the TUI restarts",
  async () => {
    const sessionID = "ses_autoapprove_restart"
    const state: AutoApproveState = { enabled: false }
    await (async () => {
      await using first = await createAppFixture({
        width: 110,
        height: 34,
        args: { sessionID },
        config: { animations: false, tabs: { mode: "off" } },
        fetch: withSession(sessionID, state),
      })
      await first.ready
      await until(first, "session", (frame) => frame.includes("Demo Model"))
      await first.mockInput.typeText("/auto-approve")
      first.mockInput.pressEnter()
      await until(first, "enabled toast", (frame) => frame.includes("Auto-approve enabled."))
    })()

    // A fresh TUI config still restores auto-approve from the saved global rule.
    await using restarted = await createAppFixture({
      width: 110,
      height: 34,
      args: { sessionID },
      config: { animations: false, tabs: { mode: "off" } },
      fetch: withSession(sessionID, state),
    })
    await restarted.ready
    await until(restarted, "session", (frame) => frame.includes("Demo Model"))
    expect(state.enabled).toBe(true)
    expect(restarted.captureCharFrame()).toContain(" auto ")
  },
  30000,
)

test(
  "a global disable from another client returns this TUI to prompting",
  async () => {
    const sessionID = "ses_autoapprove_remote_off"
    const state: AutoApproveState = { enabled: true }
    await using app = await createAppFixture({
      width: 110,
      height: 34,
      args: { sessionID },
      config: { animations: false, tabs: { mode: "off" }, session: { permissions: "autoaccept" } },
      fetch: withSession(sessionID, state),
    })
    await app.ready
    await until(app, "session", (frame) => frame.includes("Demo Model"))
    expect(app.captureCharFrame()).toContain(" auto ")

    state.enabled = false
    app.events.emit({ id: "evt_config_updated", created: 1, type: "config.updated", data: {} })
    await until(app, "auto marker gone", (frame) => !frame.includes(" auto "))
  },
  30000,
)

test(
  "a failed global save leaves the TUI mode and config unchanged",
  async () => {
    const state: AutoApproveState = { enabled: false }
    await using app = await createAppFixture({
      fetch: async (url, request) => {
        if (url.pathname === "/api/rpc/kilocode.settings/write")
          return json({ _tag: "RpcError", type: "failed", message: "conflict" }, { status: 400 })
        return settings(state)(url, request)
      },
    })
    await app.ready
    await app.waitForFrame((frame) => frame.includes("ctrl+p commands"))

    app.mockInput.pressKey("a", { ctrl: true, meta: true })
    await app.waitForFrame((frame) => frame.includes("Could not save the auto-approve setting."))
    expect(state.enabled).toBe(false)
    expect(app.config().session?.permissions).toBeUndefined()
  },
  30000,
)

test(
  "leaves a --auto launch without keeping auto-approve",
  async () => {
    const sessionID = "ses_autoapprove_flag"
    const state: AutoApproveState = { enabled: false }
    await using app = await createAppFixture({
      width: 110,
      height: 34,
      args: { sessionID, auto: true },
      config: { animations: false, tabs: { mode: "off" } },
      fetch: withSession(sessionID, state),
    })
    await app.ready
    await until(app, "session", (frame) => frame.includes("Demo Model"))
    expect(app.captureCharFrame()).toContain(" auto ")

    app.mockInput.pressKey("a", { ctrl: true, meta: true })
    await until(app, "disabled toast", (frame) => frame.includes("Auto-approve disabled."))
    // The flag still seeds later launches, so leaving it must last for this process even though the setting is saved.
    expect(app.captureCharFrame()).not.toContain(" auto ")
    expect(state.enabled).toBe(false)
  },
  30000,
)

test(
  "auto-approve approves a pending permission request without prompting",
  async () => {
    const sessionID = "ses_autoapprove"
    const requestID = "per_autoapprove"
    const replied = Promise.withResolvers<string>()
    // The permission list is the server's view; it keeps the request until the reply arrives, so a sync that races
    // the event cannot drop it.
    let pending = false
    const state: AutoApproveState = { enabled: false }
    const remote = settings(state)
    const pendingRequest = { id: requestID, sessionID, action: "shell", resources: ["git status"] }
    await using app = await createAppFixture({
      width: 110,
      height: 34,
      args: { sessionID },
      config: { animations: false, tabs: { mode: "off" } },
      fetch: async (url, request) => {
        if (url.pathname === `/api/session/${sessionID}/permission`)
          return json({ data: pending ? [pendingRequest] : [] })
        if (url.pathname === `/api/session/${sessionID}/permission/${requestID}/reply`) {
          const body = (await request.json()) as { decision: string }
          pending = false
          replied.resolve(body.decision)
          return new Response(null, { status: 204 })
        }
        return (await remote(url, request)) ?? sessionFetch(sessionID)(url)
      },
    })
    await app.ready
    await app.waitForFrame((frame) => frame.includes("Demo Model"))

    pending = true
    app.events.emit({
      id: "evt_permission_asked",
      created: 1,
      type: "permission.asked",
      data: pendingRequest,
    })
    await until(app, "permission prompt", (frame) => frame.includes("Permission required"))

    // The composer is disabled while a permission prompt waits, so the shortcut is the way in.
    app.mockInput.pressKey("a", { ctrl: true, meta: true })
    await until(app, "enabled toast", (frame) => frame.includes("Auto-approve enabled."))

    expect(await replied.promise).toBe("once")
    app.events.emit({
      id: "evt_permission_replied",
      created: 2,
      type: "permission.replied",
      data: { sessionID, requestID, reply: "once" },
    })
    await until(app, "prompt gone", (frame) => !frame.includes("Permission required"))
  },
  30000,
)

test(
  "a permissions settings write clears the runtime override",
  async () => {
    const sessionID = "ses_autoapprove_settings"
    const state: AutoApproveState = { enabled: false }
    await using app = await createAppFixture({
      width: 110,
      height: 34,
      args: { sessionID },
      config: {
        animations: false,
        tabs: { mode: "off" },
        session: { permissions: "autoaccept" },
      },
      fetch: withSession(sessionID, state),
    })
    await app.ready
    await until(app, "session", (frame) => frame.includes("Demo Model"))
    expect(app.captureCharFrame()).toContain(" auto ")

    // Leave the override equal to the configured value, with no saved global rule, so only the settings write can
    // change the effective mode.
    setPermissionMode("autoaccept")

    await app.mockInput.typeText("/settings")
    app.mockInput.pressEnter()
    await until(app, "settings dialog", (frame) => frame.includes("Color mode"))
    await app.mockInput.typeText("Permissions")
    await until(app, "permissions row", (frame) => frame.includes("Permissions"))
    app.mockInput.pressEnter()
    app.mockInput.pressEscape()
    await until(app, "auto marker gone", (frame) => !frame.includes(" auto "))
  },
  30000,
)
