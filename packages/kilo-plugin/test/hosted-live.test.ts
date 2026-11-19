import { expect, test } from "bun:test"
import { Schema } from "effect"
import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { createLive } from "../src/hosted/live"
import { frames } from "../src/hosted/live-io"
import { parsePage, Projection } from "../src/hosted/live-state"

const sessionID = "ses_00000000000000000000000001"
const target = {
  scope: "account-and-project",
  providerID: "kilo-cloud",
  workspaceID: "workspace_a",
  sessionID,
} as const
const signal = new AbortController().signal
const directory = `/cloud-agent/sessions/${sessionID}`
const selector = new URLSearchParams({ directory }).toString()
const history = `/kilo/session/${sessionID}/message?limit=40`
const event = (type: string, properties: Record<string, unknown> = {}) => ({
  type,
  properties: { sessionID, directory, ...properties },
})
const fence = event("kilo.native.fence", { snapshotComplete: true, fence: 42 })

function stored(text: string) {
  return [
    {
      info: { id: "msg_fixture", sessionID, role: "user", time: { created: 1 } },
      parts: [{ type: "text", id: "prt_fixture", messageID: "msg_fixture", sessionID, text }],
    },
  ]
}

test("a scoped Cloud lease reads history, consumes the fence, forwards native actions, and detaches without stopping", async () => {
  const calls: { path: string; body?: unknown }[] = []
  const connected = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>()
  const disconnected = Promise.withResolvers<void>()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname + url.search
      calls.push({ path, ...(req.method === "POST" && { body: await req.json() }) })
      if (path === history)
        return Response.json(stored("saved"), {
          headers: { "x-next-cursor": "ABC", Link: '<https://unused.invalid>; rel="next"' },
        })
      if (path === `${history}&before=ABC`) return Response.json(stored("earlier"))
      if (path === `/kilo/event?${selector}`)
        return new Response(
          new ReadableStream({
            start(controller) {
              connected.resolve(controller)
              controller.enqueue(new TextEncoder().encode(": connected\r\n\r\n"))
            },
            cancel() {
              disconnected.resolve()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      if (path.endsWith("/prompt_async") || path.endsWith("/command")) return new Response(null, { status: 204 })
      return Response.json(true)
    },
  })
  const live = createLive({
    async authorize(claim) {
      expect(claim).toEqual(target)
    },
    request(claim, path, init) {
      expect(claim).toEqual(target)
      return fetch(new URL(path, server.url), init)
    },
  })
  try {
    const base = { target, ...(await live.attach({ target }, signal)) }
    const first = await live.read(base, signal)
    const before = first.snapshot?.before
    expect(typeof before).toBe("string")
    expect(before).not.toBe("ABC")
    expect(first.snapshot).toMatchObject({
      connection: "connecting",
      messages: [{ type: "user", text: "saved" }],
    })
    const stream = await connected.promise
    const push = (...values: unknown[]) =>
      stream.enqueue(new TextEncoder().encode(values.map((v) => `data: ${JSON.stringify(v)}\r\n\r\n`).join("")))
    push(
      event("question.asked", { id: "que_1", questions: [{ question: "Proceed?", options: [{ label: "Yes" }] }] }),
      event("permission.asked", { id: "per_1", permission: "read", patterns: ["project/*"] }),
      event("session.status", { status: { type: "busy" } }),
      fence,
    )
    const ready = await live.read({ ...base, revision: first.revision }, signal)
    expect(ready.snapshot).toMatchObject({
      connection: "live",
      status: "busy",
      questions: [{ id: "que_1" }],
      permissions: [{ id: "per_1" }],
    })
    const info = { id: "msg_agent", sessionID, role: "assistant", time: { created: 2 } }
    push(
      event("message.updated", { info }),
      event("message.part.updated", {
        part: { id: "prt_agent", sessionID, messageID: info.id, type: "text", text: "hel" },
      }),
      event("message.part.delta", { partID: "prt_agent", messageID: info.id, field: "text", delta: "lo" }),
    )
    let seen = ready
    while (
      !seen.snapshot?.messages.some(
        (m) => m.type === "assistant" && m.content.some((p) => p.type === "text" && p.text === "hello"),
      )
    ) {
      seen = await live.read({ ...base, revision: seen.revision }, signal)
    }
    await expect(live.history({ ...base, before: "ABC" }, signal)).rejects.toThrow("cursor expired")
    expect(await live.history({ ...base, before: before! }, signal)).toMatchObject({
      messages: [{ type: "user", text: "earlier" }],
    })
    expect(() => live.interrupt({ ...base, target: { ...target, scope: "other" } }, signal)).toThrow("expired")
    expect(() => live.replyPermission({ ...base, requestID: "per_other", reply: "always" }, signal)).toThrow(
      "no longer pending",
    )
    const messageID = "msg_111111111111abcdefghijklmN"
    await live.command({ ...base, messageID, command: "compact", arguments: "" }, signal)
    await live.prompt({ ...base, text: "continue", messageID, agent: "code", model: "vendor/model" }, signal)
    await live.replyQuestion({ ...base, requestID: "que_1", answers: [["Yes"]] }, signal)
    await live.rejectQuestion({ ...base, requestID: "que_1" }, signal)
    await live.replyPermission({ ...base, requestID: "per_1", reply: "once" }, signal)
    await live.interrupt(base, signal)
    const waiting = live.read({ ...base, revision: seen.revision }, signal)
    const aborted = waiting.then(
      () => false,
      () => true,
    )
    await live.detach(base, signal)
    expect(await aborted).toBe(true)
    await disconnected.promise
    expect(calls).toEqual([
      { path: history },
      { path: `/kilo/event?${selector}` },
      { path: `${history}&before=ABC` },
      { path: `/kilo/session/${sessionID}/command`, body: { messageID, command: "compact", arguments: "" } },
      {
        path: `/kilo/session/${sessionID}/prompt_async`,
        body: {
          messageID,
          agent: "code",
          model: { providerID: "kilo", modelID: "vendor/model" },
          parts: [{ type: "text", text: "continue" }],
        },
      },
      { path: `/kilo/question/que_1/reply?${selector}`, body: { answers: [["Yes"]] } },
      { path: `/kilo/question/que_1/reject?${selector}`, body: {} },
      { path: `/kilo/permission/per_1/reply?${selector}`, body: { reply: "once" } },
      { path: `/kilo/session/${sessionID}/abort`, body: {} },
    ])
  } finally {
    live.close()
    await server.stop(true)
  }
})

test("delivery is fenced to its session and accepted work stops being cancellable", () => {
  const projection = new Projection(sessionID, [], undefined)
  const messageId = "msg_111111111111abcdefghijklmN"
  projection.apply(event("cloud.message.queued", { messageId, sessionID: "other" }))
  expect(projection.snapshot("live").queued).toBeUndefined()
  projection.apply(event("cloud.message.queued", { messageId }))
  expect(projection.snapshot("live").queued).toEqual([messageId])
  projection.apply(event("cloud.message.sent", { messageId }))
  expect(projection.snapshot("live").queued).toBeUndefined()
})

test("a continuity loss rebuilds from durable history and a new stream, without replaying input", async () => {
  let count = 0
  const live = createLive({
    authorize: async () => {},
    request: async (_, path) => {
      if (path === history) return Response.json(stored(count ? "fresh" : "initial"))
      expect(path).toBe(`/kilo/event?${selector}`)
      count++
      const payload =
        count === 1 ? [fence, event("kilo.native.resnapshot", { reason: "continuity_unproven" })] : [fence]
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(payload.map((v) => `data: ${JSON.stringify(v)}\n\n`).join("")))
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  try {
    const base = { target, ...(await live.attach({ target }, signal)) }
    let next = await live.read(base, signal)
    while (count < 2 || next.snapshot?.connection !== "live")
      next = await live.read({ ...base, revision: next.revision }, signal)
    expect(next.snapshot?.messages[0]).toMatchObject({ type: "user", text: "fresh" })
    expect(count).toBe(2)
  } finally {
    live.close()
  }
})

test("stopped runtime still exposes persisted messages, and passive attach never posts", async () => {
  const calls: string[] = []
  const live = createLive({
    authorize: async () => {},
    request: async (_, path, init) => {
      calls.push(`${init.method} ${path}`)
      if (path === history) return Response.json(stored("cold"))
      return Response.json({ error: "KILO_LIVE_RUNTIME_UNAVAILABLE" }, { status: 503 })
    },
  })
  try {
    const base = { target, ...(await live.attach({ target }, signal)) }
    let result = await live.read(base, signal)
    while (result.snapshot?.connection !== "sleeping")
      result = await live.read({ ...base, revision: result.revision }, signal)
    expect(result.snapshot.messages[0]).toMatchObject({ type: "user", text: "cold" })
    expect(result.snapshot.error).toBeUndefined()
    expect(calls).toEqual([`GET ${history}`, `GET /kilo/event?${selector}`])
  } finally {
    live.close()
  }
})

test("only matching native conversation updates and deltas enter the scoped transcript", () => {
  const view = new Projection(sessionID, [])
  const source = { version: "v2", session: { id: sessionID, location: { directory: "/private" } } }
  const message = { id: "msg_agent", type: "assistant", time: { created: 2 }, content: [{ type: "text", text: "Hi" }] }
  expect(
    view.apply(event("conversation.message.updated", { source: { ...source, session: { id: "sibling" } }, message })),
  ).toBe(false)
  view.apply(event("conversation.message.updated", { source, message }))
  view.apply(fence)
  view.apply(
    event("conversation.event", {
      event: {
        type: "session.text.delta",
        data: { sessionID, assistantMessageID: message.id, ordinal: 0, delta: " there" },
      },
    }),
  )
  expect(view.snapshot("live").messages).toMatchObject([
    { id: "msg_agent", type: "assistant", time: { created: 2 }, content: [{ type: "text", text: "Hi there" }] },
  ])
  expect(view.apply(event("kilo.native.fence", { sessionID: "sibling", snapshotComplete: true }))).toBe(false)
  expect(() => parsePage(stored("x"), "sibling")).toThrow()
})

test("a runtime step streams before its materialized assistant message arrives", () => {
  const view = new Projection(sessionID, [])
  const data = { sessionID, assistantMessageID: "msg_live" }
  const frame = (type: string, extra: object) =>
    event("conversation.event", { event: { type, data: { ...data, ...extra } } })
  view.apply(frame("session.step.started", { started: 2, agent: "code", model: { id: "cloud", providerID: "kilo" } }))
  for (const delta of ["one", " two", " three"])
    expect(view.apply(frame("session.text.delta", { ordinal: 0, delta }))).toBe(true)
  expect(view.snapshot("live").messages[0]).toMatchObject({ content: [{ type: "text", text: "one two three" }] })
})

test("callback routing metadata stays private across both durable reads and stream replay", () => {
  const text = 'Cloud Agent session context.\n<cloud-agent-context session-id="private" />'
  const [entry] = stored(text)
  const injected = { ...entry.parts[0], id: "prt_context", synthetic: true }
  const ordinary = entry.parts[0]
  const view = new Projection(sessionID, parsePage([{ ...entry, parts: [injected, ordinary] }], sessionID))
  view.apply(event("message.part.updated", { part: injected }))
  view.apply(fence)
  expect(view.snapshot("live").messages[0]).toMatchObject({ type: "user", text })
})

test("malformed targets and oversized SSE frames fail closed", async () => {
  let outgoing = 0
  const live = createLive({
    authorize: async () => {},
    request: async () => {
      outgoing++
      return Response.json([])
    },
  })
  await expect(live.attach({ target: { ...target, sessionID: "../unsafe" } }, signal)).rejects.toThrow("Invalid")
  expect(outgoing).toBe(0)
  const response = new Response("data: " + "x".repeat(300_000), { headers: { "content-type": "text/event-stream" } })
  await expect(frames(response, signal, () => {}).next()).rejects.toThrow("invalid")
  live.close()
})

test("a sleeping Cloud session reads its native durable page and replays only safe preparation and sandbox facts", async () => {
  const control = "workspace_11111111-1111-4111-8111-111111111111"
  const source = { version: "v2", session: { id: sessionID, location: { directory: "/private" } } }
  const input = { filePath: "README.md" }
  const content = [{ type: "text", text: "contents" }] as const
  const tool = {
    type: "tool",
    id: "call_read",
    name: "read",
    state: { status: "completed", input, content },
    time: { created: 2, ran: 3, completed: 4 },
  } as const
  const assistant: KiloHostedRpc.Message = {
    type: "assistant",
    id: "msg_agent",
    agent: "code",
    model: { providerID: "kilo", id: "model" },
    time: { created: 2, completed: 5 },
    content: [tool],
  }
  const user: KiloHostedRpc.Message = { type: "user", id: "msg_first", time: { created: 1 }, text: "Read the file" }
  const cancelled = Promise.withResolvers<void>()
  const live = createLive({
    authorize: async () => control,
    request: async (_, path, init) => {
      expect(init.method).toBe("GET")
      if (path.startsWith("/trpc/getSessionMessagesPage?")) {
        expect(JSON.parse(new URL(path, "https://fixture.invalid").searchParams.get("input")!)).toEqual({
          sessionId: control,
          kiloSessionId: sessionID,
          limit: 40,
        })
        return Response.json({
          result: {
            data: {
              kind: "success",
              info: { id: sessionID },
              source,
              messages: [{ message: user }, { message: assistant }],
              nextCursor: null,
            },
          },
        })
      }
      if (path === `/kilo/event?${selector}`)
        return Response.json({ error: "KILO_LIVE_RUNTIME_UNAVAILABLE" }, { status: 503 })
      expect(path).toBe(`/kilo/cloud-agent/event?${selector}`)
      const prep = {
        step: "cloning",
        attemptId: "private-attempt",
        timestamp: 2,
        label: "private label",
        message: "private progress",
        command: "private command",
        revision: 3,
      }
      const events = [
        event("cloud.status", { cloudStatus: { type: "ready", message: "private" } }),
        event("preparing", {
          preparation: { ...prep, action: "attempt_snapshot", attempt: { status: "completed", startedAt: 1 } },
        }),
        event("preparing", {
          preparation: {
            ...prep,
            action: "step_snapshot",
            stepSnapshot: { key: "cloning", status: "completed", outputTail: "private output" },
          },
        }),
        event("preparing", { preparation: { ...prep, action: "step_started", revision: 1 } }),
        event("preparing", { sessionID: "sibling", preparation: { step: "failed" } }),
        event("cloud.sandbox.status", { sandbox: { status: "sleeping", privateID: control } }),
      ]
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")))
          },
          cancel() {
            cancelled.resolve()
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  try {
    const base = { target, ...(await live.attach({ target }, signal)) }
    let next = await live.read(base, signal)
    while (next.snapshot?.connection !== "sleeping" || !next.snapshot.progress?.sandbox)
      next = await live.read({ ...base, revision: next.revision }, signal)
    expect(next.snapshot.messages).toEqual([user, assistant])
    expect(next.snapshot.progress).toEqual({
      phase: "ready",
      sandbox: "sleeping",
      preparation: "completed",
      steps: [{ step: "cloning", status: "completed" }],
    })
    expect(JSON.stringify(next.snapshot)).not.toContain("private")
    expect(Schema.is(KiloHostedRpc.Snapshot)(next.snapshot)).toBe(true)
    await live.detach(base, signal)
    await cancelled.promise
  } finally {
    live.close()
  }
})

test("reports a failed initial prompt with no history when its sandbox sleeps, and clears the failure on recovery", async () => {
  const feed = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>()
  const live = createLive({
    authorize: async () => "workspace_11111111-1111-4111-8111-111111111111",
    request: async (_, path) => {
      if (path === `/kilo/cloud-agent/event?${selector}`)
        return new Response(
          new ReadableStream({
            start(c) {
              feed.resolve(c)
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      if (path === `/kilo/event?${selector}` || path === history)
        return Response.json({ error: "KILO_LIVE_RUNTIME_UNAVAILABLE" }, { status: 503 })
      expect(path.startsWith("/trpc/getSessionMessagesPage?")).toBe(true)
      return Response.json({
        result: { data: { kind: "success", info: { id: sessionID }, messages: [], nextCursor: null } },
      })
    },
  })
  try {
    const base = { target, ...(await live.attach({ target }, signal)) }
    const stream = await feed.promise
    const push = (type: string, properties: Record<string, unknown>) =>
      stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event(type, properties))}\n\n`))
    push("cloud.status", { cloudStatus: { type: "error", message: "private" } })
    push("cloud.sandbox.status", { sandbox: { status: "sleeping" } })
    let next = await live.read(base, signal)
    while (!next.snapshot?.progress?.sandbox || next.snapshot.connection !== "sleeping")
      next = await live.read({ ...base, revision: next.revision }, signal)
    expect(next.snapshot.messages).toEqual([])
    expect(next.snapshot.error).toContain("Cloud could not start this session")
    expect(next.snapshot.error).not.toContain("private")
    push("cloud.status", { cloudStatus: { type: "ready" } })
    const recovered = await live.read({ ...base, revision: next.revision }, signal)
    expect(recovered.snapshot?.progress?.phase).toBe("ready")
    expect(recovered.snapshot?.error).toBeUndefined()
  } finally {
    live.close()
  }
})

test("a reconnect with lagging history and a genuine stream failure preserves the last fenced message", async () => {
  let reads = 0
  const live = createLive({
    authorize: async () => {},
    request: async (_, path) => {
      if (path === history) return Response.json(reads ? [] : stored("last known prompt"))
      if (++reads > 1) return Response.json({ error: "KILO_OTHER_FAILURE", message: "private" }, { status: 503 })
      const events = [fence, event("kilo.native.resnapshot")]
      return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      })
    },
  })
  try {
    const base = { target, ...(await live.attach({ target }, signal)) }
    let next = await live.read(base, signal)
    while (next.snapshot?.error !== "Cloud live updates are temporarily unavailable.")
      next = await live.read({ ...base, revision: next.revision }, signal)
    expect(next.snapshot).toMatchObject({
      connection: "disconnected",
      messages: [{ type: "user", text: "last known prompt" }],
    })
  } finally {
    live.close()
  }
})

test("scoped native tool events and legacy saved tool parts render equivalent state and keep completion times", () => {
  const id = "msg_agent"
  const input = { command: "pwd" }
  const content = [{ type: "text", text: "/project" }]
  const view = new Projection(sessionID, [])
  view.apply(
    event("conversation.message.updated", {
      source: { version: "v2", session: { id: sessionID } },
      message: {
        id,
        type: "assistant",
        agent: "code",
        model: { providerID: "kilo", id: "test/model" },
        time: { created: 1 },
        content: [],
      },
    }),
  )
  const apply = (type: string, created: number, data: object) =>
    view.apply(
      event("conversation.event", {
        event: { type, created, data: { sessionID, assistantMessageID: id, id: "call_one", ...data } },
      }),
    )
  apply("session.tool.input.started", 2, { name: "bash" })
  apply("session.tool.input.delta", 2, { delta: '{"command":' })
  apply("session.tool.input.ended", 2, { text: JSON.stringify(input) })
  apply("session.tool.called", 3, { input })
  apply("session.tool.success", 4, { content })
  const legacy = new Projection(
    sessionID,
    parsePage(
      [
        {
          info: {
            id,
            sessionID,
            role: "assistant",
            modelID: "test/model",
            providerID: "kilo",
            agent: "code",
            time: { created: 1, completed: 5 },
          },
          parts: [
            {
              type: "tool",
              id: "prt_1",
              sessionID,
              messageID: id,
              tool: "bash",
              callID: "call_one",
              state: { status: "completed", input, output: "/project", time: { start: 3, end: 4 } },
            },
          ],
        },
      ],
      sessionID,
    ),
  )
  const expected = {
    type: "tool",
    id: "call_one",
    name: "bash",
    state: { status: "completed", input, content },
    time: { ran: 3, completed: 4 },
  }
  for (const snapshot of [legacy.snapshot("sleeping"), view.snapshot("live")]) {
    expect(snapshot.messages[0]).toMatchObject({
      model: { providerID: "kilo", id: "test/model" },
      agent: "code",
      time: { created: 1 },
      content: [expected],
    })
    expect(Schema.is(KiloHostedRpc.Snapshot)(snapshot)).toBe(true)
  }
})
