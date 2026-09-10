import { expect, test } from "bun:test"
import { createClient } from "@kilocode/client"
import { Effect, Fiber } from "effect"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { createRemoteSessionPlugin } from "../src/remote-session"
import { SuggestionDismissedError, createRemoteSuggestions } from "../src/remote-suggestions"
import type { Layout } from "../src/paths"
import { fixture } from "./fixture"

function interactiveLayout(root: string, home: string): Layout {
  const paths = {
    home,
    data: path.join(root, "data"),
    config: path.join(root, "config"),
    cache: path.join(root, "cache"),
    state: path.join(root, "state"),
    tmp: path.join(root, "tmp"),
    bin: path.join(root, "cache", "bin"),
    log: path.join(root, "data", "log"),
    repos: path.join(root, "data", "repos"),
  }
  return {
    channel: "interactive",
    paths,
    roots: [paths.data, paths.cache, paths.config, paths.state, paths.tmp],
    database: path.join(paths.data, "kilo2.db"),
    config: path.join(paths.config, "kilo.jsonc"),
    tuiConfig: path.join(paths.config, "tui.json"),
    telemetryConfig: path.join(paths.config, "telemetry.json"),
    password: path.join(paths.state, "server.password"),
    pty: path.join(paths.tmp, "pty"),
  }
}

// Scripted loopback model (relayModelServer pattern): the suggest tool call is
// keyed on the transcript probe marker; after any tool result, for the title
// generator, or for the admitted follow-up prompt the model responds plainly.
function suggestModelServer() {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body = (await request.json()) as { messages: Array<{ role: string; content?: unknown }> }
      const transcript = JSON.stringify(body.messages)
      const tool =
        body.messages.at(-1)?.role === "tool" ||
        transcript.includes("title generator") ||
        transcript.includes("relay suggestion followup") ||
        transcript.includes("another relay prompt")
          ? undefined
          : transcript.includes("relay suggest probe")
            ? {
                name: "suggest",
                arguments: JSON.stringify({
                  suggest: "Review the relay fixture changes",
                  actions: [
                    { label: "Review now", prompt: "relay suggestion followup" },
                    { label: "Later", prompt: "relay suggestion later" },
                  ],
                }),
              }
            : undefined
      const delta = tool
        ? { tool_calls: [{ index: 0, id: `call_${tool.name}_${transcript.length}`, type: "function", function: tool }] }
        : { role: "assistant", content: "Fixture complete" }
      const finish = tool ? "tool_calls" : "stop"
      return new Response(
        [
          { choices: [{ index: 0, delta, finish_reason: null }] },
          { choices: [{ index: 0, delta: {}, finish_reason: finish }] },
        ]
          .map(
            (frame) =>
              `data: ${JSON.stringify({ id: "relay-model", object: "chat.completion.chunk", model: "chat", created: 1, ...frame })}\n\n`,
          )
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function response(value: unknown, id: string) {
  return isRecord(value) && value.type === "response" && value.id === id
}

const suggestionFrames = (frames: readonly unknown[], event: string) =>
  frames.filter((frame) => isRecord(frame) && frame.type === "event" && frame.event === event && isRecord(frame.data))

async function awaitFrame(values: unknown[], matches: (value: unknown) => boolean) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const value = values.find((item) => matches(item))
    if (value !== undefined) return value
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for relay frame: ${JSON.stringify(values.at(-1))}`)
}

async function waitFor(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await check()) return true
    await Bun.sleep(10)
  }
  return false
}

// Real loopback host + relay + scripted model in one scoped run: the test body
// executes inside the launch scope so the host, adapter, and sockets stay live.
async function withSuggestFixture(
  name: string,
  body: (harness: {
    readonly client: ReturnType<typeof createClient>
    readonly frames: unknown[]
    readonly send: (data: unknown) => void
    readonly closeSocket: () => void
    readonly directory: string
    readonly root: string
  }) => Promise<void>,
) {
  const input = await fixture()
  const model = suggestModelServer()
  const opened = Promise.withResolvers<void>()
  const frames: unknown[] = []
  let socket: { send(data: string): void; close(code?: number, reason?: string): void } | undefined
  const relay = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url)
      if (url.pathname !== "/api/user/cli") return new Response(null, { status: 404 })
      if (server.upgrade(request)) return
      return new Response(null, { status: 400 })
    },
    websocket: {
      open() {
        opened.resolve()
      },
      message(_ws, message) {
        frames.push(JSON.parse(String(message)))
        socket = _ws
      },
    },
  })
  const location = { directory: process.cwd() }
  const layout = interactiveLayout(path.join(input.directory, name), input.home)
  let remoteClient: ReturnType<typeof createClient> | undefined
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            content: JSON.stringify({
              model: "fixture/chat",
              providers: {
                fixture: {
                  package: "aisdk:@ai-sdk/openai-compatible",
                  settings: { baseURL: `${model.url.origin}/v1`, apiKey: "fixture" },
                  models: { chat: {} },
                },
              },
            }),
            plugins: [
              createRemoteSessionPlugin({
                relayURL: `http://127.0.0.1:${relay.port}`,
                bearerToken: "fixture-bearer",
                client: () => {
                  if (!remoteClient) throw new Error("remote client unavailable before activation")
                  return remoteClient
                },
                allowHttpLoopback: true,
              }),
            ],
          })
          const client = createClient({
            baseUrl: server.url,
            headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
          })
          remoteClient = client
          yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
          yield* Effect.promise(() => opened.promise)
          const harness = {
            client,
            frames,
            send: (data: unknown) => socket?.send(JSON.stringify(data)),
            closeSocket: () => socket?.close(),
            directory: process.cwd(),
            root: input.directory,
          }
          yield* Effect.promise(() => body(harness))
        }),
      ),
    )
  } finally {
    await relay.stop(true)
    await model.stop(true)
    await input[Symbol.asyncDispose]()
  }
}

// Request identity must be fresh per process (board 113): a counter restarts
// with the daemon, so a resumed session could receive a stale remote accept
// targeting a newer suggestion.
test("suggestion request identity is random per holder and listener failures never strand settles", async () => {
  const first = createRemoteSuggestions()
  const second = createRemoteSuggestions()
  const firstShow = first.show({
    sessionID: "ses_one",
    text: "t",
    actions: [{ label: "L", prompt: "p" }],
  })
  const secondShow = second.show({
    sessionID: "ses_one",
    text: "t",
    actions: [{ label: "L", prompt: "p" }],
  })
  // Identity is structural randomness, not a restartable counter.
  expect(firstShow.id).toMatch(/^sug_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  expect(secondShow.id).not.toBe(firstShow.id)
  expect(first.pending()).toHaveLength(1)
  expect(second.pending()).toHaveLength(1)

  // A throwing listener neither prevents the settle nor skips later updates.
  const holder = createRemoteSuggestions()
  holder.setEligibility(async () => true)
  const failures: string[] = []
  const unsubscribe = holder.onUpdate(() => {
    throw new Error("fixture listener failure")
  })
  const shown = holder.show({ sessionID: "ses_two", text: "t", actions: [{ label: "L", prompt: "p" }] })
  await Bun.sleep(20)
  expect(holder.pending()).toHaveLength(1)
  holder.accept(shown.id, 0)
  expect(await shown.done).toEqual({ label: "L", prompt: "p" })
  expect(holder.pending()).toHaveLength(0)
  unsubscribe()

  // A settle on an empty holder still publishes to remaining listeners, and a
  // second dismiss stays idempotent.
  const seen: string[] = []
  holder.onUpdate((update) => {
    seen.push(update.type)
  })
  const again = holder.show({ sessionID: "ses_two", text: "t", actions: [{ label: "L", prompt: "p" }] })
  const againRejection = again.done.catch((error: unknown) => error)
  await Bun.sleep(20)
  expect(holder.dismiss(again.id)).toBe(true)
  expect(holder.dismiss(again.id)).toBe(false)
  expect(await againRejection).toBeInstanceOf(SuggestionDismissedError)
  await Bun.sleep(20)
  expect(seen).toEqual(["shown", "dismissed"])

  // Without an adapter-supplied eligibility accessor the check reports
  // ineligible: the producer never shows a card for a session no viewer can
  // see.
  const gated = createRemoteSuggestions()
  expect(await Effect.runPromise(gated.ensureEligible("ses_three"))).toBe(false)
  expect(gated.pending()).toHaveLength(0)
}, 10_000)

// Board 121: the eligibility lookup runs inside the tool's interruptible
// execution, so cancelling during the lookup prevents the later insertion —
// no orphaned visible card can appear after the turn was interrupted.
test("cancelling during the eligibility lookup prevents later insertion", async () => {
  const holder = createRemoteSuggestions()
  const gate = Promise.withResolvers<boolean>()
  holder.setEligibility(() => gate.promise)
  const updates: string[] = []
  holder.onUpdate((update) => {
    updates.push(update.type)
  })
  const program = Effect.gen(function* () {
    const eligible = yield* holder.ensureEligible("ses_lookup")
    if (!eligible) return "unavailable"
    const shown = holder.show({ sessionID: "ses_lookup", text: "t", actions: [{ label: "L", prompt: "p" }] })
    const settled = yield* Effect.promise(() =>
      shown.done.then(
        (value) => ({ kind: "accepted" as const, action: value }),
        () => ({ kind: "dismissed" as const }),
      ),
    )
    return settled.kind
  })
  const pendingAfterInterrupt = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(program)
        yield* Effect.sleep(30)
        yield* Fiber.interrupt(fiber)
        const pending = holder.pending()
        // Resolving the gate afterwards must not resurrect the card: the
        // interrupted fiber never reaches show.
        gate.resolve(true)
        return pending
      }),
    ),
  )
  await Bun.sleep(20)
  expect(pendingAfterInterrupt).toHaveLength(0)
  expect(holder.pending()).toHaveLength(0)
  expect(updates).toEqual([])
}, 10_000)

test("accepts a remote suggestion and admits the chosen action once", async () => {
  await withSuggestFixture("remote-suggestions-accept", async ({ client, frames, send }) => {
    const session = await client.session.create({ title: "Suggest fixture", location: { directory: process.cwd() } })
    send({ type: "subscribe", sessionId: session.id })
    send({
      type: "command",
      id: "suggest-prompt-1",
      command: "send_message",
      data: { sessionID: session.id, messageID: "msg_suggest_1", parts: [{ type: "text", text: "relay suggest probe" }] },
    })
    expect(await awaitFrame(frames, (frame) => response(frame, "suggest-prompt-1"))).toEqual({
      type: "response",
      id: "suggest-prompt-1",
      result: {},
    })

    const shown = await awaitFrame(frames, (frame) => isRecord(frame) && frame.type === "event" && frame.event === "suggestion.shown")
    const requestID = isRecord(shown) && isRecord(shown.data) ? (shown.data.id as string) : undefined
    expect(typeof requestID === "string" && /^sug_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestID)).toBe(true)
    expect(shown).toMatchObject({
      type: "event",
      sessionId: session.id,
      event: "suggestion.shown",
      data: {
        sessionID: session.id,
        text: "Review the relay fixture changes",
        actions: [
          { label: "Review now", prompt: "relay suggestion followup" },
          { label: "Later", prompt: "relay suggestion later" },
        ],
      },
    })

    send({
      type: "command",
      id: "suggestion-accept-1",
      command: "suggestion_accept",
      sessionId: session.id,
      data: { requestID, index: 0 },
    })
    expect(await awaitFrame(frames, (frame) => response(frame, "suggestion-accept-1"))).toEqual({
      type: "response",
      id: "suggestion-accept-1",
      result: {},
    })
    expect(
      await awaitFrame(frames, (frame) =>
        isRecord(frame) &&
        frame.type === "event" &&
        frame.event === "suggestion.accepted" &&
        isRecord(frame.data) &&
        frame.data.requestID === requestID,
      ),
    ).toMatchObject({
      type: "event",
      sessionId: session.id,
      event: "suggestion.accepted",
      data: { requestID, index: 0, action: { label: "Review now", prompt: "relay suggestion followup" } },
    })

    // The accepted action's prompt is admitted exactly once through the public
    // session API and the model answers it as a follow-up turn.
    expect(
      await waitFor(async () =>
        (await client.session.context({ sessionID: session.id })).some(
          (message) => message.type === "user" && message.text === "relay suggestion followup",
        ),
      ),
    ).toBe(true)
    expect(
      await waitFor(async () => {
        const context = await client.session.context({ sessionID: session.id })
        const followup = context.findIndex((message) => message.type === "user" && message.text === "relay suggestion followup")
        return followup >= 0 && context.slice(followup + 1).some((message) => message.type === "assistant")
      }),
    ).toBe(true)
    const context = await client.session.context({ sessionID: session.id })
    expect(
      context.filter((message) => message.type === "user" && message.text === "relay suggestion followup"),
    ).toHaveLength(1)

    // A second accept of the same requestID refuses: the card settled, so no
    // duplicate follow-up prompt can be injected.
    send({
      type: "command",
      id: "suggestion-accept-2",
      command: "suggestion_accept",
      sessionId: session.id,
      data: { requestID, index: 1 },
    })
    expect(await awaitFrame(frames, (frame) => response(frame, "suggestion-accept-2"))).toEqual({
      type: "response",
      id: "suggestion-accept-2",
      error: "suggestion not found or invalid action index",
    })
  })
}, 90_000)

test("dismisses suggestions and refuses stale, foreign, and malformed settle commands", async () => {
  await withSuggestFixture("remote-suggestions-dismiss", async ({ client, frames, send, directory, root }) => {
    const session = await client.session.create({ title: "Suggest dismiss", location: { directory } })
    send({ type: "subscribe", sessionId: session.id })

    // Malformed data refuses before any state is touched.
    send({
      type: "command",
      id: "suggest-invalid-1",
      command: "suggestion_accept",
      sessionId: session.id,
      data: { index: 0 },
    })
    expect(await awaitFrame(frames, (frame) => response(frame, "suggest-invalid-1"))).toEqual({
      type: "response",
      id: "suggest-invalid-1",
      error: "invalid suggestion_accept data",
    })

    send({
      type: "command",
      id: "dismiss-prompt-1",
      command: "send_message",
      data: { sessionID: session.id, messageID: "msg_dismiss_1", parts: [{ type: "text", text: "relay suggest probe" }] },
    })
    await awaitFrame(frames, (frame) => response(frame, "dismiss-prompt-1"))
    const shown = await awaitFrame(frames, (frame) => isRecord(frame) && frame.type === "event" && frame.event === "suggestion.shown")
    const requestID = isRecord(shown) && isRecord(shown.data) ? (shown.data.id as string) : ""
    expect(requestID.startsWith("sug_")).toBe(true)

    // An invalid action index refuses without settling the card.
    send({
      type: "command",
      id: "suggest-index-1",
      command: "suggestion_accept",
      sessionId: session.id,
      data: { requestID, index: 9 },
    })
    expect(await awaitFrame(frames, (frame) => response(frame, "suggest-index-1"))).toEqual({
      type: "response",
      id: "suggest-index-1",
      error: "suggestion not found or invalid action index",
    })

    // A foreign routed session refuses: the pending lives on the fixture
    // session, not on a session the consumer is configured on.
    const foreignDirectory = path.join(root, "remote-suggestions-foreign")
    await mkdir(foreignDirectory, { recursive: true })
    const foreign = await client.session.create({ title: "Foreign suggest", location: { directory: foreignDirectory } })
    send({
      type: "command",
      id: "suggest-foreign-1",
      command: "suggestion_accept",
      sessionId: foreign.id,
      data: { requestID, index: 0 },
    })
    expect(await awaitFrame(frames, (frame) => response(frame, "suggest-foreign-1"))).toEqual({
      type: "response",
      id: "suggest-foreign-1",
      error: "session unavailable",
    })

    // Dismiss settles the card and publishes the dismissed frame; a second
    // dismiss of the same id is an idempotent no-op success (v1 parity).
    send({
      type: "command",
      id: "suggestion-dismiss-1",
      command: "suggestion_dismiss",
      sessionId: session.id,
      data: { requestID },
    })
    expect(await awaitFrame(frames, (frame) => response(frame, "suggestion-dismiss-1"))).toEqual({
      type: "response",
      id: "suggestion-dismiss-1",
      result: {},
    })
    expect(
      await awaitFrame(frames, (frame) =>
        isRecord(frame) &&
        frame.type === "event" &&
        frame.event === "suggestion.dismissed" &&
        isRecord(frame.data) &&
        frame.data.requestID === requestID,
      ),
    ).toMatchObject({ type: "event", sessionId: session.id, event: "suggestion.dismissed", data: { requestID } })
    send({
      type: "command",
      id: "suggestion-dismiss-2",
      command: "suggestion_dismiss",
      sessionId: session.id,
      data: { requestID },
    })
    expect(await awaitFrame(frames, (frame) => response(frame, "suggestion-dismiss-2"))).toEqual({
      type: "response",
      id: "suggestion-dismiss-2",
      result: {},
    })

    // An accept of the already-dismissed id refuses with v1's exact error.
    send({
      type: "command",
      id: "suggestion-accept-stale-1",
      command: "suggestion_accept",
      sessionId: session.id,
      data: { requestID, index: 0 },
    })
    expect(await awaitFrame(frames, (frame) => response(frame, "suggestion-accept-stale-1"))).toEqual({
      type: "response",
      id: "suggestion-accept-stale-1",
      error: "suggestion not found or invalid action index",
    })
  })
}, 90_000)

test("auto-dismisses a pending suggestion when a prompt is queued and replays still-pending cards on reconnect", async () => {
  await withSuggestFixture("remote-suggestions-lifecycle", async ({ client, frames, send, closeSocket }) => {
    const session = await client.session.create({ title: "Suggest lifecycle", location: { directory: process.cwd() } })
    send({ type: "subscribe", sessionId: session.id })
    send({
      type: "command",
      id: "lifecycle-prompt-1",
      command: "send_message",
      data: { sessionID: session.id, messageID: "msg_lifecycle_1", parts: [{ type: "text", text: "relay suggest probe" }] },
    })
    await awaitFrame(frames, (frame) => response(frame, "lifecycle-prompt-1"))
    const shown = await awaitFrame(frames, (frame) => isRecord(frame) && frame.type === "event" && frame.event === "suggestion.shown")
    const requestID = isRecord(shown) && isRecord(shown.data) ? (shown.data.id as string) : ""

    // Reconnect: the still-pending card replays for the subscribed session
    // (v1 replay parity).
    const shownBefore = suggestionFrames(frames, "suggestion.shown").length
    closeSocket()
    expect(await waitFor(async () => suggestionFrames(frames, "suggestion.shown").length > shownBefore)).toBe(true)
    const replayed = suggestionFrames(frames, "suggestion.shown").at(-1)
    expect(isRecord(replayed) && isRecord(replayed.data) && replayed.data.id === requestID).toBe(true)

    // A newly queued prompt auto-dismisses the pending card (v1 parity: a
    // newer prompt dismisses the session's suggestion).
    send({
      type: "command",
      id: "lifecycle-prompt-2",
      command: "send_message",
      data: { sessionID: session.id, messageID: "msg_lifecycle_2", parts: [{ type: "text", text: "another relay prompt" }] },
    })
    expect(await awaitFrame(frames, (frame) => response(frame, "lifecycle-prompt-2"))).toEqual({
      type: "response",
      id: "lifecycle-prompt-2",
      result: {},
    })
    expect(
      await awaitFrame(frames, (frame) =>
        isRecord(frame) &&
        frame.type === "event" &&
        frame.event === "suggestion.dismissed" &&
        isRecord(frame.data) &&
        frame.data.requestID === requestID,
      ),
    ).toMatchObject({ type: "event", sessionId: session.id, event: "suggestion.dismissed", data: { requestID } })

    // The dismissed tool settles the model turn; the queued prompt is the only
    // admitted follow-up and the dismissed card never injects.
    expect(
      await waitFor(async () =>
        (await client.session.context({ sessionID: session.id })).some(
          (message) => message.type === "user" && message.text === "another relay prompt",
        ),
      ),
    ).toBe(true)
    expect(
      (await client.session.context({ sessionID: session.id })).filter(
        (message) => message.type === "user" && message.text === "relay suggestion followup",
      ),
    ).toHaveLength(0)
  })
}, 90_000)

// Board 111: remote enabled at the Location does not mean a viewer subscribed
// to every local session. A suggest call in an unsubscribed session must fail
// promptly (tool settles with the unavailable result) instead of hanging the
// turn on a card nobody can see.
test("an unsubscribed session's suggest call fails promptly without a card", async () => {
  await withSuggestFixture("remote-suggestions-unsubscribed", async ({ client, frames, send, directory }) => {
    const subscribed = await client.session.create({ title: "Suggest subscribed", location: { directory } })
    send({ type: "subscribe", sessionId: subscribed.id })

    // A second same-location session the viewer never subscribed to.
    const unsubscribed = await client.session.create({ title: "Suggest hidden", location: { directory } })
    await client.session.prompt({ sessionID: unsubscribed.id, text: "relay suggest probe" })

    // The tool settled promptly: the model received the unavailable result and
    // completed the turn — no hang, no delivered card.
    expect(
      await waitFor(async () => {
        const context = await client.session.context({ sessionID: unsubscribed.id })
        const probe = context.findIndex((message) => message.type === "user" && message.text === "relay suggest probe")
        return probe >= 0 && context.slice(probe + 1).some((message) => message.type === "assistant")
      }),
    ).toBe(true)
    expect(
      frames.some(
        (frame) =>
          isRecord(frame) &&
          frame.type === "event" &&
          frame.event === "suggestion.shown" &&
          isRecord(frame.data) &&
          frame.data.sessionID === unsubscribed.id,
      ),
    ).toBe(false)

    // The subscribed session's flow is unaffected by the refusal.
    send({
      type: "command",
      id: "subscribed-prompt-1",
      command: "send_message",
      data: { sessionID: subscribed.id, messageID: "msg_sub_1", parts: [{ type: "text", text: "relay suggest probe" }] },
    })
    expect(await awaitFrame(frames, (frame) => response(frame, "subscribed-prompt-1"))).toEqual({
      type: "response",
      id: "subscribed-prompt-1",
      result: {},
    })
    expect(
      await awaitFrame(frames, (frame) =>
        isRecord(frame) &&
        frame.type === "event" &&
        frame.event === "suggestion.shown" &&
        isRecord(frame.data) &&
        frame.data.sessionID === subscribed.id,
      ),
    ).toMatchObject({ type: "event", sessionId: subscribed.id, event: "suggestion.shown" })
  })
}, 90_000)
