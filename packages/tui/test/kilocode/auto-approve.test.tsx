import { beforeEach, describe, expect, it, test } from "bun:test"
import { permissionModeOverride, setPermissionMode, togglePermissionMode } from "../../src/kilocode/permission-mode"
import { createAppFixture } from "../fixture/app"
import { directory, json } from "../fixture/tui-client"

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

  it("toggles from the effective mode and keeps the override", () => {
    expect(togglePermissionMode("prompt")).toBe("autoaccept")
    expect(permissionModeOverride()).toBe("autoaccept")
    expect(togglePermissionMode("autoaccept")).toBe("prompt")
    expect(permissionModeOverride()).toBe("prompt")
  })

  it("degrades an unrecognized mode to prompting", () => {
    expect(togglePermissionMode("future-mode" as Parameters<typeof togglePermissionMode>[0])).toBe("prompt")
    expect(permissionModeOverride()).toBe("prompt")
  })

  it("falls back to the configured mode when the override is cleared", () => {
    togglePermissionMode("prompt")
    setPermissionMode(undefined)
    expect(permissionModeOverride()).toBeUndefined()
  })
})

test(
  "/auto-approve and Ctrl+Alt+A toggle auto-approve",
  async () => {
    await using app = await createAppFixture()
    await app.ready
    await app.waitForFrame((frame) => frame.includes("ctrl+p commands"))

    await app.mockInput.typeText("/auto-approve")
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Auto-approve enabled."))

    app.mockInput.pressKey("a", { ctrl: true, meta: true })
    await app.waitForFrame((frame) => frame.includes("Auto-approve disabled."))

    expect(app.captureCharFrame()).not.toContain("Auto-approve enabled.")
  },
  30000,
)

test(
  "auto-approve approves a pending permission request without prompting",
  async () => {
    const sessionID = "ses_autoapprove"
    const requestID = "per_autoapprove"
    const location = { directory, project: { id: "project", directory, canonical: directory } }
    const replied = Promise.withResolvers<string>()
    // The permission list is the server's view; it keeps the request until the reply arrives, so a sync that races
    // the event cannot drop it.
    let pending = false
    const pendingRequest = { id: requestID, sessionID, action: "shell", resources: ["git status"] }
    await using app = await createAppFixture({
      width: 110,
      height: 34,
      args: { sessionID },
      config: { animations: false, tabs: { mode: "off" } },
      fetch: async (url, request) => {
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
        if (url.pathname === `/api/session/${sessionID}/permission`) return json({ data: pending ? [pendingRequest] : [] })
        if (url.pathname === `/api/session/${sessionID}/permission/${requestID}/reply`) {
          const body = (await request.json()) as { decision: string }
          pending = false
          replied.resolve(body.decision)
          return new Response(null, { status: 204 })
        }
        return undefined
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
