import { beforeEach, describe, expect, it, test } from "bun:test"
import { nextPermissionMode, permissionModeOverride, setPermissionMode } from "../../src/kilocode/permission-mode"
import { createAppFixture } from "../fixture/app"
import { directory, json } from "../fixture/tui-client"

const location = { directory, project: { id: "project", directory, canonical: directory } }

type AutoApproveState = { enabled: boolean; project?: boolean; writes?: number; values?: unknown[] }

/** The `kilocode.auto-approve` and `kilocode.settings` RPCs over one in-memory store. */
function settings(state: AutoApproveState) {
  return async (url: URL, request: Request) => {
    if (url.pathname === "/api/rpc/kilocode.auto-approve/get") {
      const value = state.project === false ? "narrowed" : state.enabled ? "enabled" : "disabled"
      return json({ output: { state: value } })
    }
    if (url.pathname === "/api/rpc/kilocode.settings/target") {
      return json({
        output: { scope: "global", path: `${directory}/global-kilo2.json`, revision: "rev", exists: true },
      })
    }
    if (url.pathname === "/api/rpc/kilocode.settings/write") {
      const body = (await request.clone().json()) as { input?: { set?: { auto_approve?: boolean | null } } }
      state.writes = (state.writes ?? 0) + 1
      const written = body.input?.set?.auto_approve
      state.values = [...(state.values ?? []), written]
      state.enabled = written === true
      return json({
        output: {
          scope: "global",
          target: { scope: "global", path: `${directory}/global-kilo2.json`, revision: "next", exists: true },
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
  "retries once on a revision conflict when saving",
  async () => {
    const state: AutoApproveState = { enabled: false }
    let attempts = 0
    await using app = await createAppFixture({
      fetch: async (url, request) => {
        if (url.pathname === "/api/rpc/kilocode.settings/write" && attempts++ === 0)
          return json({ _tag: "RpcError", type: "conflict", message: "revision changed" }, { status: 400 })
        return settings(state)(url, request)
      },
    })
    await app.ready
    await app.waitForFrame((frame) => frame.includes("ctrl+p commands"))

    app.mockInput.pressKey("a", { ctrl: true, meta: true })
    await app.waitForFrame((frame) => frame.includes("Auto-approve enabled."))
    expect(attempts).toBe(2)
    expect(state.enabled).toBe(true)
  },
  30000,
)

test(
  "writes false on disable so a lower-precedence global file cannot keep auto-approve on",
  async () => {
    const sessionID = "ses_autoapprove_lower_global"
    const state: AutoApproveState = { enabled: true }
    await using app = await createAppFixture({
      width: 110,
      height: 34,
      args: { sessionID },
      config: { animations: false, tabs: { mode: "off" } },
      fetch: withSession(sessionID, state),
    })
    await app.ready
    await until(app, "session", (frame) => frame.includes("Demo Model"))
    expect(app.captureCharFrame()).toContain(" auto ")

    app.mockInput.pressKey("a", { ctrl: true, meta: true })
    await until(app, "disabled toast", (frame) => frame.includes("Auto-approve disabled."))
    expect(state.values).toEqual([false])
    expect(app.captureCharFrame()).not.toContain(" auto ")
  },
  30000,
)

test(
  "ignores a config.updated refresh while a toggle write is in flight",
  async () => {
    const sessionID = "ses_autoapprove_race"
    const state: AutoApproveState = { enabled: false }
    const writeStarted = Promise.withResolvers<void>()
    const releaseWrite = Promise.withResolvers<void>()
    const base = withSession(sessionID, state)
    await using app = await createAppFixture({
      width: 110,
      height: 34,
      args: { sessionID },
      config: { animations: false, tabs: { mode: "off" } },
      fetch: async (url, request) => {
        if (url.pathname === "/api/rpc/kilocode.settings/write") {
          writeStarted.resolve()
          await releaseWrite.promise
        }
        return base(url, request)
      },
    })
    await app.ready
    await until(app, "session", (frame) => frame.includes("Demo Model"))

    app.mockInput.pressKey("a", { ctrl: true, meta: true })
    await writeStarted.promise
    app.events.emit({ id: "evt_mid_write", created: 1, type: "config.updated", data: {} })
    await Bun.sleep(50)
    releaseWrite.resolve()

    await until(app, "enabled toast", (frame) => frame.includes("Auto-approve enabled."))
    expect(state.enabled).toBe(true)
    expect(app.captureCharFrame()).toContain(" auto ")
  },
  30000,
)

test(
  "toggling off local session.permissions leaves the global config untouched",
  async () => {
    const sessionID = "ses_autoapprove_local_off"
    const state: AutoApproveState = { enabled: false }
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

    app.mockInput.pressKey("a", { ctrl: true, meta: true })
    await until(app, "disabled toast", (frame) => frame.includes("Auto-approve disabled."))
    expect(app.captureCharFrame()).not.toContain(" auto ")
    expect(state.writes ?? 0).toBe(0)
  },
  30000,
)

test(
  "keeps --auto active when another client disables the saved global rule",
  async () => {
    const sessionID = "ses_autoapprove_flag_remote_off"
    const state: AutoApproveState = { enabled: true }
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

    state.enabled = false
    app.events.emit({ id: "evt_remote_disable", created: 1, type: "config.updated", data: {} })
    await Bun.sleep(150)
    expect(app.captureCharFrame()).toContain(" auto ")
  },
  30000,
)

test(
  "surfaces project narrowing instead of reporting auto-approve enabled",
  async () => {
    const sessionID = "ses_autoapprove_narrowed"
    const state: AutoApproveState = { enabled: true, project: false }
    await using app = await createAppFixture({
      width: 110,
      height: 34,
      args: { sessionID },
      config: { animations: false, tabs: { mode: "off" } },
      fetch: withSession(sessionID, state),
    })
    await app.ready
    await until(app, "session", (frame) => frame.includes("Demo Model"))
    expect(app.captureCharFrame()).not.toContain(" auto ")

    app.mockInput.pressKey("a", { ctrl: true, meta: true })
    await until(app, "project disabled toast", (frame) =>
      frame.includes("Auto-approve is disabled by this project's config."),
    )
    expect(app.captureCharFrame()).not.toContain(" auto ")
    expect(state.writes ?? 0).toBe(0)
  },
  30000,
)

test(
  "leaves a --auto launch for this run without writing global config",
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
    expect(app.captureCharFrame()).not.toContain(" auto ")
    expect(state.enabled).toBe(false)
    expect(state.writes ?? 0).toBe(0)
  },
  30000,
)

test(
  "disables auto-approve cleanly when both --auto and the saved global rule are active",
  async () => {
    const sessionID = "ses_autoapprove_flag_and_saved"
    const state: AutoApproveState = { enabled: true }
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
    // Emitting config.updated after the local write must not bounce the `--auto` process back on.
    app.events.emit({ id: "evt_config_updated", created: 1, type: "config.updated", data: {} })
    await Bun.sleep(150)
    expect(state.enabled).toBe(false)
    expect(app.captureCharFrame()).not.toContain(" auto ")
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
