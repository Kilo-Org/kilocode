import { expect, test } from "bun:test"
import { KiloAccount } from "@kilocode/gateway-core"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { createLive } from "../src/hosted/live"
import { broadcastTypes } from "../src/hosted/live-broadcast"
import { streamSocket } from "../src/hosted/live-broadcast-ticket"

const target = { scope: "account", providerID: "kilo-cloud", workspaceID: "work", sessionID: "root" } as const
const control = "workspace_control"
const signal = new AbortController().signal
const queued = "msg_111111111111abcdefghijklmN"
const fence = { type: "kilo.native.fence", properties: { sessionID: "root", snapshotComplete: true } }
const delta = (id: string, text: string, sessionID = "root") => ({
  type: "conversation.event",
  properties: {
    sessionID,
    source: { version: "v2" },
    event: {
      id,
      type: "session.text.delta",
      data: { sessionID, assistantMessageID: "msg_assistant", ordinal: 0, delta: text },
    },
  },
})
const whole = (text: string) => ({
  type: "conversation.message.updated",
  properties: {
    sessionID: "root",
    source: { version: "v2", session: { id: "root" } },
    message: { id: "msg_assistant", type: "assistant", time: { created: 2 }, content: [{ type: "text", text }] },
  },
})
const text = (s: KiloHostedRpc.Snapshot) => {
  const msg = s.messages.find((m) => m.type === "assistant")
  return msg?.type === "assistant" && msg.content[0]?.type === "text" ? msg.content[0].text : undefined
}

function native() {
  const encoder = new TextEncoder()
  const feed = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>()
  let count = 0
  return {
    async push(...events: unknown[]) {
      ;(await feed.promise).enqueue(encoder.encode(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")))
    },
    async request(_: KiloHostedRpc.Target, path: string) {
      if (path.startsWith("/trpc/"))
        return Response.json({
          result: { data: { kind: "success", info: { id: "root" }, nextCursor: null, messages: [] } },
        })
      return new Response(
        new ReadableStream({
          start(c) {
            if (!path.startsWith("/kilo/event?")) return
            if (++count === 1) feed.resolve(c)
            else
              c.enqueue(
                encoder.encode([whole("rehydrated"), fence].map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")),
              )
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  }
}

async function reader(live: ReturnType<typeof createLive>) {
  const lease = { target, ...(await live.attach({ target }, signal)) }
  let revision: number | undefined
  return async (predicate: (s: KiloHostedRpc.Snapshot) => boolean) => {
    for (;;) {
      const result = await live.read({ ...lease, revision }, signal)
      revision = result.revision
      if (result.snapshot && predicate(result.snapshot)) return result.snapshot
    }
  }
}

test("a grouped lease hands off fenced transcript updates to the root's ticketed stream and rehydrates on loss", async () => {
  const ws = Promise.withResolvers<Bun.ServerWebSocket<undefined>>()
  let grants = 0
  using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req, srv) {
      const url = new URL(req.url)
      if (url.pathname === "/api/cloud-agent-next/sessions/stream-ticket") {
        grants++
        expect(req.headers.get("authorization")).toBe("Bearer fixture")
        expect(await req.json()).toEqual({ cloudAgentSessionId: control })
        return Response.json({ ticket: "fixture-grant", expiresAt: Date.now() / 1000 + 60 })
      }
      expect(url.pathname).toBe("/stream")
      expect(Object.fromEntries(url.searchParams)).toEqual({
        cloudAgentSessionId: control,
        ticket: "fixture-grant",
        replay: "false",
        bootstrap: "true",
        eventTypes: broadcastTypes,
      })
      expect(req.headers.get("authorization")).toBeNull()
      if (!srv.upgrade(req)) return new Response(null, { status: 400 })
    },
    websocket: { open: ws.resolve, message() {} },
  })
  const stream = native()
  const live = createLive({
    authorize: async () => control,
    request: stream.request,
    openBroadcast: (_, id, s) =>
      streamSocket(
        KiloAccount.resolve({ token: "fixture" }, {}),
        { issuer: server.url.origin, worker: server.url.origin },
        id,
        broadcastTypes,
        s,
      ),
  })
  try {
    const read = await reader(live)
    await stream.push(whole("baseline"))
    expect(grants).toBe(0)
    await stream.push(fence)
    await read((s) => text(s) === "baseline" && s.connection === "live")
    const socket = await ws.promise
    const send = (type: string, data: unknown, sessionId: string = control, extra: object = {}) =>
      socket.send(JSON.stringify({ eventId: 0, sessionId, streamEventType: type, data, ...extra }))
    send("bootstrap.complete", {})
    send("kilocode", whole("one"), control, { eventId: 9, cursor: 12 })
    send("kilocode", delta("evt_a", " two"), control, { eventId: 9, cursor: 13 })
    await read((s) => text(s) === "one two")
    send("kilocode", delta("evt_a", " two"))
    send("kilocode", delta("evt_child", " child", "child"))
    send("kilocode", delta("evt_wrong", " wrong"), "workspace_sibling")
    send("kilocode", delta("evt_b", " three"), control, { eventId: 9, cursor: 14 })
    await read((s) => text(s) === "one two three")
    // The delayed facade copy must not append to the already broadcast-owned row.
    await stream.push(delta("evt_b", " three"), {
      type: "session.status",
      properties: { sessionID: "root", status: { type: "busy" } },
    })
    expect(text(await read((s) => s.status === "busy"))).toBe("one two three")
    send("cloud.message.queued", { messageId: queued })
    await read((s) => s.queued?.includes(queued) === true)
    send("cloud.message.canceled", { messageId: queued })
    await read((s) => !s.queued)
    socket.terminate()
    await read((s) => s.connection === "live" && text(s) === "rehydrated")
  } finally {
    live.close()
  }
})

test("an unavailable broadcast grant leaves the fenced native tail active", async () => {
  const stream = native()
  const denied = Promise.withResolvers<void>()
  const live = createLive({
    authorize: async () => control,
    request: stream.request,
    openBroadcast: async () => {
      denied.resolve()
      throw new Error("ticket unavailable")
    },
  })
  try {
    const read = await reader(live)
    await stream.push(fence)
    await denied.promise
    await stream.push(whole("native"), delta("evt_fallback", " fallback"))
    expect((await read((s) => text(s) === "native fallback")).connection).toBe("live")
  } finally {
    live.close()
  }
})
