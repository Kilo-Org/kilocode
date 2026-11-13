// Attention listens on the host's Agent Manager connection. These tests run it over a real connection to a local SSE
// server, so the event decoding, the session lookup and the goal RPC go through the same client as in the extension.
// Only the effects at the edge (playing a sound, showing a notification) are captured.
import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { createAgentManagerConnection } from "../src/agent-manager/connection"
import { attentionSettings } from "../src/attention/host"
import type { AttentionNotice } from "../src/attention/notice"
import { createAttention, type AttentionKind, type AttentionSettings } from "../src/attention/service"
import type { AttentionSoundID } from "../src/attention/sound"
import type { Manager, Server } from "../src/server"

const encoder = new TextEncoder()
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
const sessions = new Map<string, { parentID?: string; title?: string; directory?: string }>()
const goals = new Map<string, "active" | "paused" | "complete">()
let subscriptions = 0

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })

const http = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/api/event") {
      subscriptions++
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streams.add(controller)
          controller.enqueue(encoder.encode(frame({ type: "server.connected", id: "evt_0", created: 0, data: {} })))
        },
        cancel() {
          streams.clear()
        },
      })
      return new Response(stream, { headers: { "content-type": "text/event-stream" } })
    }
    if (url.pathname === "/api/rpc/opencode.goal/get") {
      const body = (await request.json()) as { input: { sessionID: string } }
      const status = goals.get(body.input.sessionID)
      return json({ output: status ? goal(status) : null })
    }
    const get = /^\/api\/session\/([^/]+)$/.exec(url.pathname)
    const info = get ? sessions.get(get[1]!) : undefined
    if (get && info)
      return json({
        data: {
          id: get[1],
          projectID: "prj_1",
          parentID: info.parentID,
          title: info.title,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1 },
          location: { directory: info.directory ?? "/repo" },
        },
      })
    return new Response(JSON.stringify({ _tag: "NotFound", message: "not found" }), { status: 404 })
  },
})

afterAll(() => http.stop(true))

function goal(status: "active" | "paused" | "complete") {
  return { id: "goal_1", objective: "Ship it", status, rounds: 0, maxRounds: 50, boot: "boot", updatedAt: 1 }
}

function frame(event: unknown) {
  return `data: ${JSON.stringify(event)}\n\n`
}

function emit(type: string, data: Record<string, unknown>, directory = "/repo") {
  const event = { id: `evt_${crypto.randomUUID()}`, created: 1, type, location: { directory }, data }
  streams.forEach((controller) => controller.enqueue(encoder.encode(frame(event))))
}

function end() {
  streams.forEach((controller) => controller.close())
  streams.clear()
}

const server = { url: `http://127.0.0.1:${http.port}`, authorization: "Basic test" } as Server
const manager = { get: async () => server } as unknown as Manager

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return
    await Bun.sleep(10)
  }
  throw new Error("condition not reached")
}

const ON: AttentionSettings = { enabled: true, notifications: true, os: true, sound: "default" }

async function setup(
  options: {
    settings?: Partial<AttentionSettings>
    focused?: boolean
    visible?: (sessionID: string) => boolean
    approves?: boolean
    choose?: boolean
  } = {},
) {
  const sounds: Array<{ kind: AttentionKind; sound: AttentionSoundID }> = []
  const messages: Array<{ kind: AttentionKind; text: string }> = []
  const toasts: AttentionNotice[] = []
  const shown: Array<{ sessionID: string; directory?: string }> = []
  const connection = createAgentManagerConnection({ server: manager, reconnect: 10 })
  const settings = { ...ON, ...options.settings }
  const attention = createAttention({
    connection,
    settings: () => settings,
    play: (kind, sound) => sounds.push({ kind, sound }),
    os: (notice) => toasts.push(notice),
    message: async (kind, text, action) => {
      messages.push({ kind, text })
      return options.choose ? action : undefined
    },
    focused: () => options.focused ?? false,
    visible: options.visible ?? (() => false),
    approves: () => options.approves ?? false,
    workspace: (directory) => directory?.split("/").pop(),
    show: (sessionID, directory) => shown.push({ sessionID, directory }),
  })
  connection.started(server)
  await until(() => connection.state() === "connected")
  return {
    sounds,
    messages,
    toasts,
    shown,
    connection,
    dispose: () => {
      attention.dispose()
      connection.dispose()
    },
  }
}

beforeEach(() => {
  end()
  sessions.clear()
  goals.clear()
  subscriptions = 0
})

describe("attention", () => {
  test("reads every setting as off, with the default sound, until the user changes it", () => {
    expect(attentionSettings()).toEqual({ enabled: false, notifications: false, os: false, sound: "default" })
  })

  test("a finished root session plays the done sound and shows both notifications", async () => {
    sessions.set("ses_root", { title: "Add notifications", directory: "/work/kilo" })
    const test = await setup({ settings: { sound: "yup-02" } })
    emit("session.execution.succeeded", { sessionID: "ses_root" }, "/work/kilo")
    await until(() => test.messages.length === 1)
    expect(test.sounds).toEqual([{ kind: "done", sound: "yup-02" }])
    expect(test.messages).toEqual([
      { kind: "done", text: "Kilo task completed. Workspace: kilo | Session: Add notifications" },
    ])
    expect(test.toasts).toEqual([{ message: "Kilo task completed.", workspace: "kilo", session: "Add notifications" }])
    test.dispose()
  })

  test("nothing plays or shows while every setting is off", async () => {
    sessions.set("ses_root", {})
    const test = await setup({ settings: { enabled: false, notifications: false, os: false } })
    emit("permission.asked", { id: "per_1", sessionID: "ses_root", action: "bash", resources: ["ls"] })
    emit("form.created", { form: { id: "frm_1", sessionID: "ses_root", title: "Pick", fields: [] } })
    emit("session.execution.failed", { sessionID: "ses_root", error: { type: "unknown", message: "boom" } })
    emit("session.execution.succeeded", { sessionID: "ses_root" })
    await Bun.sleep(50)
    expect(test.sounds).toEqual([])
    expect(test.messages).toEqual([])
    expect(test.toasts).toEqual([])
    test.dispose()
  })

  test("only the enabled channels fire", async () => {
    sessions.set("ses_root", {})
    const sound = await setup({ settings: { notifications: false, os: false } })
    emit("session.execution.succeeded", { sessionID: "ses_root" })
    await until(() => sound.sounds.length === 1)
    await Bun.sleep(20)
    expect(sound.messages).toEqual([])
    expect(sound.toasts).toEqual([])
    sound.dispose()
    end()

    const message = await setup({ settings: { enabled: false, os: false } })
    emit("session.execution.succeeded", { sessionID: "ses_root" })
    await until(() => message.messages.length === 1)
    expect(message.sounds).toEqual([])
    expect(message.toasts).toEqual([])
    message.dispose()
  })

  test("a subagent's finished run is not announced", async () => {
    sessions.set("ses_child", { parentID: "ses_root" })
    const test = await setup()
    emit("session.execution.succeeded", { sessionID: "ses_child" })
    await Bun.sleep(50)
    expect(test.sounds).toEqual([])
    expect(test.messages).toEqual([])
    test.dispose()
  })

  test("a session with an active goal keeps working without a done announcement", async () => {
    sessions.set("ses_goal", {})
    sessions.set("ses_paused", {})
    goals.set("ses_goal", "active")
    goals.set("ses_paused", "paused")
    const test = await setup()
    emit("session.execution.succeeded", { sessionID: "ses_goal" })
    emit("session.execution.succeeded", { sessionID: "ses_paused" })
    await until(() => test.messages.length === 1)
    await Bun.sleep(20)
    expect(test.sounds.map((item) => item.kind)).toEqual(["done"])
    expect(test.messages).toHaveLength(1)
    test.dispose()
  })

  test("a failed run plays the error sound and shows an error notification", async () => {
    sessions.set("ses_root", { title: "Broken" })
    const test = await setup()
    emit("session.execution.failed", { sessionID: "ses_root", error: { type: "unknown", message: "boom" } })
    await until(() => test.messages.length === 1)
    expect(test.sounds.map((item) => item.kind)).toEqual(["error"])
    expect(test.messages[0]).toEqual({
      kind: "error",
      text: "Kilo task stopped due to an error. Workspace: repo | Session: Broken",
    })
    test.dispose()
  })

  test("an interrupted run is not an error", async () => {
    sessions.set("ses_root", {})
    const test = await setup()
    emit("session.execution.interrupted", { sessionID: "ses_root", reason: "user" })
    await Bun.sleep(50)
    expect(test.sounds).toEqual([])
    expect(test.messages).toEqual([])
    test.dispose()
  })

  test("a permission and a question are announced exactly once each, also after a reconnect", async () => {
    sessions.set("ses_root", { title: "Needs input" })
    const test = await setup()
    const permission = { id: "per_1", sessionID: "ses_root", action: "bash", resources: ["ls"] }
    const form = { form: { id: "frm_1", sessionID: "ses_root", title: "Pick", fields: [] } }
    emit("permission.asked", permission)
    emit("permission.asked", permission)
    emit("form.created", form)
    emit("form.created", form)
    await until(() => test.messages.length === 2)

    end()
    await until(() => subscriptions === 2 && test.connection.state() === "connected")
    emit("permission.asked", permission)
    emit("form.created", form)
    await Bun.sleep(50)

    expect(test.sounds.map((item) => item.kind)).toEqual(["permission", "question"])
    expect(test.messages.map((item) => item.kind)).toEqual(["permission", "question"])
    expect(test.messages[0]!.text).toBe("Kilo needs permission. Workspace: repo | Session: Needs input")
    expect(test.messages[1]!.text).toBe("Kilo needs your input. Workspace: repo | Session: Needs input")
    test.dispose()
  })

  test("a new prompt after an answered one is announced again", async () => {
    sessions.set("ses_root", {})
    const test = await setup()
    emit("permission.asked", { id: "per_1", sessionID: "ses_root", action: "bash", resources: ["ls"] })
    emit("permission.replied", { sessionID: "ses_root", requestID: "per_1", reply: "once" })
    emit("permission.asked", { id: "per_2", sessionID: "ses_root", action: "bash", resources: ["ls"] })
    emit("form.created", { form: { id: "frm_1", sessionID: "ses_root", title: "Pick", fields: [] } })
    emit("form.cancelled", { id: "frm_1", sessionID: "ses_root" })
    emit("form.created", { form: { id: "frm_2", sessionID: "ses_root", title: "Pick", fields: [] } })
    await until(() => test.messages.length === 4)
    expect(test.sounds.map((item) => item.kind)).toEqual(["permission", "permission", "question", "question"])
    test.dispose()
  })

  test("a permission the host auto-approves needs nobody's attention", async () => {
    sessions.set("ses_root", {})
    const test = await setup({ approves: true })
    emit("permission.asked", { id: "per_1", sessionID: "ses_root", action: "bash", resources: ["ls"] })
    await Bun.sleep(50)
    expect(test.sounds).toEqual([])
    expect(test.messages).toEqual([])
    test.dispose()
  })

  test("a session on screen still plays its sound but shows no VS Code notification", async () => {
    sessions.set("ses_root", {})
    sessions.set("ses_child", { parentID: "ses_root" })
    const test = await setup({ settings: { os: false }, visible: (id) => id === "ses_root" })
    emit("session.execution.succeeded", { sessionID: "ses_root" })
    // A subagent's prompt renders in the parent's chat, which is on screen.
    emit("permission.asked", { id: "per_1", sessionID: "ses_child", action: "bash", resources: ["ls"] })
    await until(() => test.sounds.length === 2)
    await Bun.sleep(50)
    // The done sound waits for the session lookup, so the prompt can sound first.
    expect(test.sounds.map((item) => item.kind).toSorted()).toEqual(["done", "permission"])
    expect(test.messages).toEqual([])
    test.dispose()
  })

  test("the OS notification fires only while the window is not focused", async () => {
    sessions.set("ses_root", {})
    const test = await setup({ focused: true })
    emit("session.execution.succeeded", { sessionID: "ses_root" })
    await until(() => test.messages.length === 1)
    expect(test.toasts).toEqual([])
    test.dispose()
  })

  test("Show on the notification reveals the session", async () => {
    sessions.set("ses_root", { directory: "/work/kilo" })
    const test = await setup({ choose: true })
    emit("session.execution.succeeded", { sessionID: "ses_root" }, "/work/kilo")
    await until(() => test.shown.length === 1)
    expect(test.shown).toEqual([{ sessionID: "ses_root", directory: "/work/kilo" }])
    test.dispose()
  })
})
