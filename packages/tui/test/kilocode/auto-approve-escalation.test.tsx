import { beforeEach, describe, expect, test } from "bun:test"
import type { PermissionReply, PermissionRequest } from "@opencode/client"
import { requiresPerson, setPermissionMode } from "../../src/kilocode/permission-mode"
import type { Config } from "../../src/config"
import { createAppFixture } from "../fixture/app"
import { directory, json } from "../fixture/tui-client"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const sessionID = "ses_escalation"

// The request the Kilo sandbox plugin asks before a Git command runs outside the sandbox.
const escalation: PermissionRequest = {
  id: "per_escalation",
  sessionID,
  action: "sandbox_escalation",
  resources: ["git commit -m escape"],
  metadata: { command: "git commit -m escape", sandboxEscalation: true, interactive: true },
}
const shell: PermissionRequest = { id: "per_shell", sessionID, action: "shell", resources: ["git status"] }
const request = (metadata: PermissionRequest["metadata"]): PermissionRequest => ({ ...shell, metadata })

beforeEach(() => setPermissionMode(undefined))

describe("requiresPerson", () => {
  test("is true only for a request marked interactive", () => {
    expect(requiresPerson(escalation)).toBe(true)
    expect(
      requiresPerson({
        ...shell,
        action: "browser_sensitive",
        metadata: { browserSensitive: true, interactive: true },
      }),
    ).toBe(true)
    expect(requiresPerson(shell)).toBe(false)
    expect(requiresPerson(request({ sandboxEscalation: true }))).toBe(false)
    expect(requiresPerson(request({ interactive: "true" }))).toBe(false)
    expect(requiresPerson(request({ interactive: false }))).toBe(false)
    expect(requiresPerson(undefined)).toBe(false)
  })
})

// A fixture server whose permission list holds the requests until they are answered, and that records every reply.
async function sessionApp(input: { config?: Config.Info; auto?: boolean }) {
  const pending = new Map<string, PermissionRequest>()
  const replies: { requestID: string; decision: string }[] = []
  const app = await createAppFixture({
    width: 110,
    height: 34,
    args: { sessionID, auto: input.auto },
    config: { animations: false, tabs: { mode: "off" }, ...input.config },
    fetch: async (url, request) => {
      if (url.pathname === `/api/session/${sessionID}/permission`) return json({ data: [...pending.values()] })
      const reply = url.pathname.match(new RegExp(`^/api/session/${sessionID}/permission/([^/]+)/reply$`))
      if (reply) {
        const body = (await request.json()) as { decision: string }
        pending.delete(reply[1])
        replies.push({ requestID: reply[1], decision: body.decision })
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `/api/session/${sessionID}`)
        return json({
          data: {
            id: sessionID,
            projectID: "project",
            title: "Escalation fixture",
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
      return undefined
    },
  })
  let sequence = 0
  const ask = (item: PermissionRequest) => {
    pending.set(item.id, item)
    app.events.emit({ id: `evt_asked_${++sequence}`, created: sequence, type: "permission.asked", data: item })
  }
  const settle = (requestID: string, reply: PermissionReply) =>
    app.events.emit({
      id: `evt_replied_${++sequence}`,
      created: sequence,
      type: "permission.replied",
      data: { sessionID, requestID, reply },
    })
  return Object.assign(app, { pending, replies, ask, settle })
}

// Frames advance faster than the SSE round trip, so a frame budget alone can expire before an event arrives.
async function until(label: string, predicate: () => boolean, frame: () => string, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(50)
  }
  throw new Error(`timed out waiting for ${label}:\n` + frame())
}

test.each([
  ["session.permissions: autoaccept", { config: { session: { permissions: "autoaccept" as const } } }],
  ["--auto", { auto: true }],
])(
  "auto-accept (%s) approves an ordinary request and prompts for a sandbox escalation",
  async (_, input) => {
    await using app = await sessionApp(input)
    await app.ready
    const frame = () => app.captureCharFrame()
    await until("session", () => frame().includes("Demo Model"), frame)
    expect(frame()).toContain(" auto ")

    app.ask(shell)
    app.ask(escalation)
    await until("shell approval", () => app.replies.some((item) => item.requestID === shell.id), frame)
    app.settle(shell.id, "once")
    await Bun.sleep(300)
    expect(app.replies).toEqual([{ requestID: shell.id, decision: "once" }])
    await until("escalation prompt", () => frame().includes("Permission required"), frame)
    expect(frame()).toContain("sandbox_escalation")

    app.mockInput.pressEnter()
    await until("escalation answer", () => app.replies.length === 2, frame)
    expect(app.replies[1]).toEqual({ requestID: escalation.id, decision: "once" })
    app.settle(escalation.id, "once")
    await until("prompt gone", () => !frame().includes("Permission required"), frame)
  },
  30000,
)

test("switching to auto-accept with an escalation pending approves only the ordinary request", async () => {
  await using app = await sessionApp({})
  await app.ready
  const frame = () => app.captureCharFrame()
  await until("session", () => frame().includes("Demo Model"), frame)

  // Prompt mode: neither request is answered, and the first one is prompted.
  app.ask(shell)
  app.ask(escalation)
  await until("shell prompt", () => frame().includes("Permission required"), frame)
  await Bun.sleep(300)
  expect(app.replies).toEqual([])
  expect(frame()).toContain("git status")

  app.mockInput.pressKey("a", { ctrl: true, meta: true })
  await until("enabled toast", () => frame().includes("Auto-approve enabled."), frame)
  await until("shell approval", () => app.replies.length > 0, frame)
  app.settle(shell.id, "once")
  await Bun.sleep(300)
  expect(app.replies).toEqual([{ requestID: shell.id, decision: "once" }])
  await until("escalation prompt", () => frame().includes("sandbox_escalation"), frame)
  expect(frame()).toContain("Permission required")
  expect(app.pending.has(escalation.id)).toBe(true)

  app.mockInput.pressEnter()
  await until("escalation answer", () => app.replies.length === 2, frame)
  expect(app.replies[1]).toEqual({ requestID: escalation.id, decision: "once" })
}, 30000)
