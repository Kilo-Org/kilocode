import { expect, test } from "bun:test"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { createLive } from "../src/hosted/live"
import type { Request } from "../src/hosted/live-history"

const target = { scope: "project", providerID: "kilo-cloud", workspaceID: "workspace_1", sessionID: "ses_one" } as const
const directory = `/cloud-agent/sessions/${target.sessionID}`
const selector = new URLSearchParams({ directory }).toString()
const system = `/kilo/cloud-agent/event?${selector}`
const native = `/kilo/event?${selector}`
const signal = new AbortController().signal

function stream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  return {
    response: new Response(body, { headers: { "content-type": "text/event-stream" } }),
    push(type: string, properties: object) {
      const event = { type, properties: { directory, sessionID: target.sessionID, ...properties } }
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    },
  }
}

async function attached(request: Request) {
  const live = createLive({ authorize: async () => "workspace_1", request })
  const base = { target, ...(await live.attach({ target }, signal)) }
  return {
    async until(match: (s: KiloHostedRpc.Snapshot) => boolean) {
      let page = await live.read(base, signal)
      while (!page.snapshot || !match(page.snapshot))
        page = await live.read({ ...base, revision: page.revision }, signal)
      return page.snapshot
    },
    close: () => live.close(),
  }
}

test("preparation reaches an authorized reader before registration and pending ingest; ready hands off to the native fence", async () => {
  const feed = stream()
  const events = stream()
  const firstPage = Promise.withResolvers<Response>()
  const attempted = Promise.withResolvers<void>()
  let available = false
  const h = await attached(async (_, path, init) => {
    expect(init.method).toBe("GET")
    if (path === system) return feed.response
    if (path.startsWith("/trpc/getSessionMessagesPage?")) {
      return available
        ? Response.json({
            result: { data: { kind: "success", info: { id: target.sessionID }, messages: [], nextCursor: null } },
          })
        : firstPage.promise
    }
    if (path === native) {
      if (available) return events.response
      attempted.resolve()
      return Response.json({ error: "KILO_LIVE_RUNTIME_UNAVAILABLE" }, { status: 503 })
    }
    expect(path).toBe(`/kilo/session/${target.sessionID}/message?limit=40`)
    return Response.json({ error: "KILO_SESSION_SNAPSHOT_PENDING" }, { status: 503 })
  })
  try {
    feed.push("cloud.status", { cloudStatus: { type: "preparing", step: "cloning", message: "private" } })
    feed.push("cloud.sandbox.status", { sandbox: { status: "sleeping" } })
    const first = await h.until((s) => s.progress?.sandbox === "sleeping")
    expect(first).toMatchObject({
      historyReady: false,
      connection: "preparing",
      progress: { phase: "preparing", step: "cloning" },
      messages: [],
    })
    expect(first.error).toBeUndefined()
    firstPage.resolve(Response.json({ result: { data: null } }))
    await attempted.promise
    available = true
    feed.push("cloud.status", { cloudStatus: { type: "ready" } })
    events.push("session.status", { status: { type: "busy" } })
    events.push("kilo.native.fence", { snapshotComplete: true, fence: 9 })
    const ready = await h.until((s) => s.connection === "live")
    expect(ready.historyReady).toBe(true)
    expect(ready.status).toBe("busy")
    expect(ready.progress?.step).toBeUndefined()
  } finally {
    h.close()
  }
})

test("paused system feed still exposes persisted preparation, but a real runtime read outage remains disconnected", async () => {
  const feed = stream()
  const result = Promise.withResolvers<Response>()
  const attempt = {
    id: "private",
    revision: 6,
    status: "running",
    startedAt: 4,
    steps: [{ key: "workspace_setup", status: "running", revision: 6, command: "private" }],
  }
  const h = await attached(async (_, path) => {
    if (path === system) return feed.response
    if (path === native) return result.promise
    return Response.json({
      result: {
        data: {
          kind: "success",
          info: { id: target.sessionID },
          messages: [],
          nextCursor: null,
          preparationAttempts: [attempt],
        },
      },
    })
  })
  try {
    const preparing = await h.until((s) => s.connection === "preparing")
    expect(preparing.progress).toEqual({
      preparation: "running",
      steps: [{ step: "workspace_setup", status: "running" }],
    })
    result.resolve(Response.json({ error: "KILO_SESSION_READ_RETRYABLE" }, { status: 503 }))
    const outage = await h.until((s) => s.connection === "disconnected")
    expect(outage.error).toBe("Cloud live updates are temporarily unavailable.")
  } finally {
    h.close()
  }
})

test.each([401, 403, 404, 410])(
  "history HTTP %d revokes the lease while its preparation feed is active",
  async (status) => {
    const feed = stream()
    const page = Promise.withResolvers<Response>()
    const h = await attached(async (_, path) => (path === system ? feed.response : page.promise))
    try {
      feed.push("cloud.status", { cloudStatus: { type: "preparing" } })
      await h.until((s) => s.connection === "preparing")
      page.resolve(new Response(null, { status }))
      await expect(h.until((s) => s.connection === "live")).rejects.toThrow(
        status < 404 ? "access was denied" : "no longer exists",
      )
    } finally {
      h.close()
    }
  },
)
