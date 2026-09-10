import { expect, test } from "bun:test"
import { createClient } from "@kilocode/client"
import { mkdir } from "node:fs/promises"
import { SessionV1 } from "@opencode-ai/schema/v1/session"
import { Effect, Schema } from "effect"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { createRemoteSessionPlugin } from "../src/remote-session"
import { createRemoteTranscript, transcriptFrames } from "../src/remote-transcript"
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

async function waitFor(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await check()) return true
    await Bun.sleep(10)
  }
  return false
}

// Scripted loopback model: plain text, a shell tool call, and text after any
// tool result or title prompt.
let holdController: ReadableStreamDefaultController<Uint8Array> | undefined
const holdReleased = Promise.withResolvers<void>()

function transcriptModelServer() {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body = (await request.json().catch(() => undefined)) as
        | { messages: Array<{ role: string; content?: unknown }> }
        | undefined
      if (body === undefined) return new Response(null, { status: 400 })
      if (JSON.stringify(body.messages).includes("relay transcript hold probe")) {
        // Deterministic paused model: one content chunk, then the stream
        // stays open until the test releases it.
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          start(controller) {
            holdController = controller
            const chunk = (payload: unknown) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
            controller.enqueue(
              chunk({
                id: "held-model",
                object: "chat.completion.chunk",
                model: "chat",
                created: 1,
                choices: [{ index: 0, delta: { role: "assistant", content: "Held " }, finish_reason: null }],
              }),
            )
            void holdReleased.promise.then(() => {
              controller.enqueue(
                chunk({
                  id: "held-model",
                  object: "chat.completion.chunk",
                  model: "chat",
                  created: 1,
                  choices: [{ index: 0, delta: { content: "complete" }, finish_reason: null }],
                }),
              )
              controller.enqueue(
                chunk({
                  id: "held-model",
                  object: "chat.completion.chunk",
                  model: "chat",
                  created: 1,
                  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                }),
              )
              controller.enqueue(encoder.encode("data: [DONE]\n\n"))
              controller.close()
              holdController = undefined
            })
          },
        })
        return new Response(stream, { headers: { "content-type": "text/event-stream" } })
      }
      const transcript = JSON.stringify(body.messages)
      const tool =
        body.messages.at(-1)?.role === "tool" || transcript.includes("title generator")
          ? undefined
          : transcript.includes("relay transcript tool error probe")
            ? { name: "definitely_not_a_tool", arguments: JSON.stringify({ probe: "fixture" }) }
            : transcript.includes("relay transcript tool probe")
              ? { name: "shell", arguments: JSON.stringify({ command: "echo relay-ok" }) }
              : undefined
      const content = "Fixture complete"
      const firstHalf = content.slice(0, Math.ceil(content.length / 2))
      const finish = tool ? "tool_calls" : "stop"
      const toolDelta = tool
        ? [
            {
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [{ index: 0, id: `call_shell_${transcript.length}`, type: "function", function: tool }],
                  },
                  finish_reason: null,
                },
              ],
            },
          ]
        : []
      const contentDeltas = tool
        ? []
        : [
            { choices: [{ index: 0, delta: { role: "assistant", content: firstHalf }, finish_reason: null }] },
            { choices: [{ index: 0, delta: { content: content.slice(firstHalf.length) }, finish_reason: null }] },
          ]
      return new Response(
        [...toolDelta, ...contentDeltas, { choices: [{ index: 0, delta: {}, finish_reason: finish }] }]
          .map(
            (frame) =>
              `data: ${JSON.stringify({ id: "transcript-model", object: "chat.completion.chunk", model: "chat", created: 1, ...frame })}\n\n`,
          )
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
}

const eventFrames = (frames: unknown[], event: string) =>
  frames.filter((frame) => isRecord(frame) && frame.type === "event" && frame.event === event)

const infoFrames = (frames: unknown[], messageID: string) =>
  eventFrames(frames, "message.updated").filter(
    (frame) =>
      isRecord((frame as Record<string, unknown>).data) &&
      isRecord(((frame as Record<string, unknown>).data as Record<string, unknown>).info) &&
      (((frame as Record<string, unknown>).data as Record<string, unknown>).info as Record<string, unknown>).id ===
        messageID,
  )

const partFrames = (frames: unknown[], partID: string) =>
  eventFrames(frames, "message.part.updated").filter(
    (frame) =>
      isRecord((frame as Record<string, unknown>).data) &&
      isRecord(((frame as Record<string, unknown>).data as Record<string, unknown>).part) &&
      (((frame as Record<string, unknown>).data as Record<string, unknown>).part as Record<string, unknown>).id ===
        partID,
  )

test("streams source-proven user, assistant, and part frames through a real host", async () => {
  await using input = await fixture()
  const model = transcriptModelServer()
  const opened = Promise.withResolvers<void>()
  const frames: unknown[] = []
  const sockets: Array<{ send(data: string): void }> = []
  frameDump = () => JSON.stringify(frames.slice(-6))
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
      open(ws) {
        sockets.push(ws)
        opened.resolve()
      },
      message(_ws, message) {
        frames.push(JSON.parse(String(message)))
      },
    },
  })
  const location = { directory: process.cwd() }
  const layout = interactiveLayout(path.join(input.directory, "remote-transcript"), input.home)
  let remoteClient: ReturnType<typeof createClient> | undefined
  let defectMessageList = false
  let wrappedTranscriptClient: ReturnType<typeof createClient> | undefined
  // Idempotent on stringified input: the queued call sites pre-stringify.
  const sendTranscript = (data: unknown) => {
    const payload = typeof data === "string" ? data : JSON.stringify(data)
    sockets.at(-1)?.send(payload)
  }
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
                  if (!wrappedTranscriptClient) {
                    const real = remoteClient
                    wrappedTranscriptClient = {
                      ...real,
                      message: {
                        ...real.message,
                        list: (input: Parameters<typeof real.message.list>[0]) => {
                          // A synchronous throw escapes the translation walk
                          // and surfaces as a defect at the catchCause
                          // boundary.
                          if (defectMessageList) {
                            defectMessageList = false
                            throw new Error("fixture translation defect")
                          }
                          return real.message.list(input)
                        },
                      },
                    } as unknown as ReturnType<typeof createClient>
                  }
                  return wrappedTranscriptClient
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
          const session = yield* Effect.promise(() =>
            client.session.create({
              title: "Relay transcript",
              location,
              agent: "build",
              model: { providerID: "fixture", id: "chat" },
            }),
          )
          yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
          yield* Effect.promise(() => opened.promise)
          sendTranscript(JSON.stringify({ type: "subscribe", sessionId: session.id }))

          // The user message with an inline attachment translates into the
          // user info frame plus text and file parts sourced from the
          // admitted projection.
          const attachment = btoa("transcript-file")
          sendTranscript(
            JSON.stringify({
              type: "command",
              id: "probe-1",
              command: "send_message",
              data: {
                sessionID: session.id,
                parts: [
                  { type: "text", text: "relay transcript probe" },
                  {
                    type: "file",
                    mime: "text/plain",
                    url: `data:text/plain;base64,${attachment}`,
                    filename: "notes.txt",
                  },
                ],
              },
            }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "probe-1")))).toEqual({
            type: "response",
            id: "probe-1",
            result: {},
          })
          const userFrame = yield* Effect.promise(() =>
            awaitLabeled("user info", () => {
              const candidates = eventFrames(frames, "message.updated").filter(
                (frame) =>
                  isRecord((frame as Record<string, unknown>).data) &&
                  isRecord(((frame as Record<string, unknown>).data as Record<string, unknown>).info) &&
                  (((frame as Record<string, unknown>).data as Record<string, unknown>).info as Record<string, unknown>)
                    .role === "user",
              )
              return Promise.resolve(candidates.at(-1))
            }),
          )
          expect(userFrame).toBeDefined()
          const userInfo = Schema.decodeUnknownSync(SessionV1.User)(
            (isRecord(userFrame) ? (userFrame.data as Record<string, unknown>).info : {}) as never,
          )
          expect(userInfo.sessionID === session.id).toBe(true)
          expect(userInfo.agent).toBe("build")
          expect(userInfo.model.modelID === "chat").toBe(true)
          const userTextID = `prt_${userInfo.id}_t0`
          const userTextPart = yield* Effect.promise(() =>
            awaitFrame(frames, (frame) => partFrames([frame], userTextID).length > 0),
          )
          const decodedUserText = Schema.decodeUnknownSync(SessionV1.TextPart)(
            (isRecord(userTextPart) ? (userTextPart.data as Record<string, unknown>).part : {}) as never,
          )
          expect(decodedUserText.text).toBe("relay transcript probe")
          const userFileID = `prt_${userInfo.id}_f0`
          const userFilePart = yield* Effect.promise(() =>
            awaitFrame(frames, (frame) => partFrames([frame], userFileID).length > 0),
          )
          const decodedFile = Schema.decodeUnknownSync(SessionV1.FilePart)(
            (isRecord(userFilePart) ? (userFilePart.data as Record<string, unknown>).part : {}) as never,
          )
          expect(decodedFile.mime).toBe("text/plain")
          expect(decodedFile.filename).toBe("notes.txt")
          expect(decodedFile.url).toBe(`data:text/plain;base64,${attachment}`)

          // Live upserts precede the info frame: text parts stream during
          // the step (the text.ended event precedes step.ended in the same
          // ordered stream), full-value under stable ids.
          const liveTextFrame = yield* Effect.promise(() =>
            awaitLabeled("live text upsert", () => {
              const candidates = eventFrames(frames, "message.part.updated").filter(
                (frame) =>
                  isRecord((frame as Record<string, unknown>).data) &&
                  isRecord(((frame as Record<string, unknown>).data as Record<string, unknown>).part) &&
                  (((frame as Record<string, unknown>).data as Record<string, unknown>).part as Record<string, unknown>)
                    .type === "text" &&
                  (((frame as Record<string, unknown>).data as Record<string, unknown>).part as Record<string, unknown>)
                    .text === "Fixture complete",
              )
              return Promise.resolve(candidates.at(-1))
            }),
          )
          expect(liveTextFrame).toBeDefined()
          const livePartID = (() => {
            if (!isRecord(liveTextFrame)) return ""
            const part = (liveTextFrame.data as Record<string, unknown>).part
            return isRecord(part) && typeof part.id === "string" ? part.id : ""
          })()
          expect(livePartID.startsWith("prt_")).toBe(true)

          // The assistant info frame arrives at step.ended with real cost and
          // token usage, the projection-derived user message as parentID, and
          // the project canonical as path.root. time.completed stops the
          // consumer's streaming view.
          // The terminal update is the assistant info carrying the
          // completion time: the early step.started frame has none.
          const assistantFrame = yield* Effect.promise(() =>
            awaitLabeled("assistant terminal info", () => {
              const candidates = eventFrames(frames, "message.updated").filter(
                (frame) =>
                  isRecord((frame as Record<string, unknown>).data) &&
                  isRecord(((frame as Record<string, unknown>).data as Record<string, unknown>).info) &&
                  (((frame as Record<string, unknown>).data as Record<string, unknown>).info as Record<string, unknown>)
                    .role === "assistant" &&
                  typeof (
                    ((frame as Record<string, unknown>).data as Record<string, unknown>).info as Record<string, unknown>
                  ).time !== "undefined" &&
                  typeof (
                    (
                      ((frame as Record<string, unknown>).data as Record<string, unknown>).info as Record<
                        string,
                        unknown
                      >
                    ).time as Record<string, unknown>
                  ).completed === "number",
              )
              return Promise.resolve(candidates.at(-1))
            }),
          )
          expect(assistantFrame).toBeDefined()
          const assistantInfo = Schema.decodeUnknownSync(SessionV1.Assistant)(
            (isRecord(assistantFrame) ? (assistantFrame.data as Record<string, unknown>).info : {}) as never,
          )
          expect(assistantInfo.parentID === userInfo.id).toBe(true)
          expect(assistantInfo.modelID === "chat").toBe(true)
          expect(assistantInfo.providerID === "fixture").toBe(true)
          expect(typeof assistantInfo.cost).toBe("number")
          expect(assistantInfo.tokens.input).toBeGreaterThanOrEqual(0)
          expect(typeof assistantInfo.time.completed).toBe("number")
          expect(typeof assistantInfo.path.root).toBe("string")
          const project = yield* Effect.promise(() => client.project.current({ location }))
          // path.root is the requested location's own checkout worktree, not
          // the canonical main clone.
          expect(assistantInfo.path.root).toBe(project.directory)
          // The ended projection snapshot reconciles the same stable id with
          // the final full value — no duplicate identities.
          const assistantTextID = `prt_${assistantInfo.id}_t0`
          expect(assistantTextID).toBe(livePartID)
          const assistantTextPart = yield* Effect.promise(() =>
            awaitLabeled("tool running part", () => {
              const candidates = partFrames(frames, assistantTextID).filter(
                (frame) =>
                  isRecord((frame as Record<string, unknown>).data) &&
                  isRecord(((frame as Record<string, unknown>).data as Record<string, unknown>).part) &&
                  (((frame as Record<string, unknown>).data as Record<string, unknown>).part as Record<string, unknown>)
                    .text === "Fixture complete",
              )
              return Promise.resolve(candidates.at(-1))
            }),
          )
          expect(assistantTextPart).toBeDefined()
          const decodedAssistantText = Schema.decodeUnknownSync(SessionV1.TextPart)(
            (isRecord(assistantTextPart) ? (assistantTextPart.data as Record<string, unknown>).part : {}) as never,
          )
          expect(decodedAssistantText.text).toBe("Fixture complete")

          // Tool run: the running frame carries the real tool name and input;
          // the terminal success upgrades it to the completed state with the
          // source-proven empty title (v1 registry/prompt convention).
          sendTranscript(
            JSON.stringify({
              type: "command",
              id: "probe-2",
              command: "send_message",
              data: {
                sessionID: session.id,
                parts: [{ type: "text", text: "relay transcript tool probe" }],
              },
            }),
          )
          yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "probe-2")))
          const runningPart = yield* Effect.promise(() =>
            awaitLabeled("tool completed part", () => {
              const candidates = eventFrames(frames, "message.part.updated").filter(
                (frame) =>
                  isRecord((frame as Record<string, unknown>).data) &&
                  isRecord(((frame as Record<string, unknown>).data as Record<string, unknown>).part) &&
                  ((frame as Record<string, unknown>).data as Record<string, unknown>).part !== null &&
                  isRecord(
                    (
                      ((frame as Record<string, unknown>).data as Record<string, unknown>).part as Record<
                        string,
                        unknown
                      >
                    ).state,
                  ) &&
                  (
                    (
                      ((frame as Record<string, unknown>).data as Record<string, unknown>).part as Record<
                        string,
                        unknown
                      >
                    ).state as Record<string, unknown>
                  ).status === "running",
              )
              return Promise.resolve(candidates.at(-1))
            }),
          )
          expect(runningPart).toBeDefined()
          const decodedTool = Schema.decodeUnknownSync(SessionV1.ToolPart)(
            (isRecord(runningPart) ? (runningPart.data as Record<string, unknown>).part : {}) as never,
          )
          expect(decodedTool.tool).toBe("shell")
          expect(decodedTool.state.status === "running" && decodedTool.state.input).toMatchObject({
            command: "echo relay-ok",
          })
          const toolCallID = decodedTool.callID
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )
          // The terminal success upgrades the running frame to the completed
          // state with the source-proven empty title (v1 registry/prompt
          // convention) and the real output text.
          const completedPart = yield* Effect.promise(() =>
            awaitLabeled("held partial upsert", () => {
              const candidates = completedFrames(frames, toolCallID)
              return Promise.resolve(candidates.at(-1))
            }),
          )
          expect(completedPart).toBeDefined()
          const decodedCompleted = Schema.decodeUnknownSync(SessionV1.ToolPart)(
            (isRecord(completedPart) ? (completedPart.data as Record<string, unknown>).part : {}) as never,
          )
          expect(decodedCompleted.state.status === "completed" && decodedCompleted.state.title).toBe("")
          expect(
            decodedCompleted.state.status === "completed" && decodedCompleted.state.output.includes("relay-ok"),
          ).toBe(true)
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )

          // Deterministic paused model: the held stream holds after one
          // content chunk. The held partial arrives first, then the early
          // assistant info (step.started, canonical zero accounting, no
          // completion) for the same message; releasing produces the terminal
          // update and the final upsert under the same ids.
          sendTranscript({
            type: "command",
            id: "hold-probe-1",
            command: "send_message",
            data: {
              sessionID: session.id,
              parts: [{ type: "text", text: "relay transcript hold probe" }],
            },
          })
          yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "hold-probe-1")))
          const heldPartial = yield* Effect.promise(() =>
            awaitLabeled("held early info", () => {
              const candidates = eventFrames(frames, "message.part.updated").filter(
                (frame) =>
                  isRecord((frame as Record<string, unknown>).data) &&
                  isRecord(((frame as Record<string, unknown>).data as Record<string, unknown>).part) &&
                  (((frame as Record<string, unknown>).data as Record<string, unknown>).part as Record<string, unknown>)
                    .text === "Held ",
              )
              return Promise.resolve(candidates.at(-1))
            }),
          )
          expect(heldPartial).toBeDefined()
          const heldPart = isRecord(heldPartial) ? (heldPartial.data as Record<string, unknown>).part : undefined
          const heldAssistantID = isRecord(heldPart) && typeof heldPart.messageID === "string" ? heldPart.messageID : ""
          const heldPartID = isRecord(heldPart) && typeof heldPart.id === "string" ? heldPart.id : ""
          expect(heldAssistantID.startsWith("msg_")).toBe(true)
          expect(heldPartID.startsWith("prt_")).toBe(true)
          // While held: exactly the early info for the held message — no
          // terminal update has arrived.
          const earlyFrame = infoFrames(frames, heldAssistantID).at(-1)
          const earlyInfo = Schema.decodeUnknownSync(SessionV1.Assistant)(
            (isRecord(earlyFrame) ? (earlyFrame.data as Record<string, unknown>).info : {}) as never,
          )
          expect(earlyInfo.id === heldAssistantID).toBe(true)
          expect(earlyInfo.cost).toBe(0)
          expect(earlyInfo.tokens.input).toBe(0)
          expect(earlyInfo.time.completed).toBeUndefined()
          expect(infoFrames(frames, heldAssistantID).length).toBe(1)
          holdReleased.resolve()
          const terminalAssistant = yield* Effect.promise(() =>
            awaitLabeled("held terminal info", () => {
              const candidates = infoFrames(frames, heldAssistantID).filter(
                (frame) =>
                  isRecord((frame as Record<string, unknown>).data) &&
                  isRecord(((frame as Record<string, unknown>).data as Record<string, unknown>).info) &&
                  typeof (
                    ((frame as Record<string, unknown>).data as Record<string, unknown>).info as Record<string, unknown>
                  ).time !== "undefined" &&
                  typeof (
                    (
                      ((frame as Record<string, unknown>).data as Record<string, unknown>).info as Record<
                        string,
                        unknown
                      >
                    ).time as Record<string, unknown>
                  ).completed === "number",
              )
              return Promise.resolve(candidates.at(-1))
            }),
          )
          expect(terminalAssistant).toBeDefined()
          const heldFinal = yield* Effect.promise(() =>
            awaitLabeled("held final upsert", () => {
              const candidates = partFrames(frames, heldPartID).filter(
                (frame) =>
                  isRecord((frame as Record<string, unknown>).data) &&
                  isRecord(((frame as Record<string, unknown>).data as Record<string, unknown>).part) &&
                  (((frame as Record<string, unknown>).data as Record<string, unknown>).part as Record<string, unknown>)
                    .text === "Held complete",
              )
              return Promise.resolve(candidates.at(-1))
            }),
          )
          expect(heldFinal).toBeDefined()

          // A translation defect must not kill the relay fiber: the
          // catchCause boundary recovers, and a later prompt streams frames
          // again. The defected prompt's own response may be lost — that is
          // the honest cost of the defect.
          defectMessageList = true
          sendTranscript({
            type: "command",
            id: "defect-probe-1",
            command: "send_message",
            data: { sessionID: session.id, parts: [{ type: "text", text: "relay transcript defect probe" }] },
          })
          yield* Effect.promise(() =>
            client.session
              .wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) })
              .catch(() => undefined),
          )
          const beforeRecovery = eventFrames(frames, "message.updated").filter(
            (frame) =>
              isRecord((frame as Record<string, unknown>).data) &&
              isRecord(((frame as Record<string, unknown>).data as Record<string, unknown>).info) &&
              (((frame as Record<string, unknown>).data as Record<string, unknown>).info as Record<string, unknown>)
                .role === "assistant",
          ).length
          sendTranscript({
            type: "command",
            id: "recovery-probe-1",
            command: "send_message",
            data: { sessionID: session.id, parts: [{ type: "text", text: "relay transcript recovery probe" }] },
          })
          yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "recovery-probe-1")))
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )
          const recoveryFrames = eventFrames(frames, "message.updated").filter(
            (frame) =>
              isRecord((frame as Record<string, unknown>).data) &&
              isRecord(((frame as Record<string, unknown>).data as Record<string, unknown>).info) &&
              (((frame as Record<string, unknown>).data as Record<string, unknown>).info as Record<string, unknown>)
                .role === "assistant",
          )
          expect(recoveryFrames.length).toBeGreaterThan(beforeRecovery)
        }),
      ),
    )
  } finally {
    await relay.stop(true)
    await model.stop(true)
  }
}, 60_000)

test("derives fresh-adapter parent, per-kind ordinals, and paginates past the default page", async () => {
  const transcript = createRemoteTranscript()
  // Projected messages, oldest first: u1, u2, synthetic, assistant with mixed
  // content. The stub serves newest-first pages of two, so the assistant is
  // on page one and its parent user on page two — pagination is required.
  const u1 = { id: "msg_u1", type: "user" as const, time: { created: 1 }, text: "first" }
  const u2 = { id: "msg_u2", type: "user" as const, time: { created: 2 }, text: "second" }
  const synthetic = { id: "msg_syn", type: "synthetic" as const, time: { created: 3 }, text: "s" }
  const assistant = {
    id: "msg_a",
    type: "assistant" as const,
    time: { created: 40 },
    agent: "build",
    model: { providerID: "fixture", id: "chat" },
    content: [
      { type: "text", text: "one" },
      { type: "reasoning", text: "r" },
      { type: "text", text: "two" },
    ],
  }
  const pages = [
    [assistant, synthetic],
    [u2, u1],
  ]
  // The worktree fixture: a second session whose location is its own
  // checkout worktree, distinct from the main clone canonical.
  const stub = {
    session: {
      get: async () => ({ id: "ses_x", agent: "build", model: { providerID: "fixture", id: "chat" } }),
    },
    message: {
      // Cursor-addressed pages: each helper's walk starts from page zero and
      // follows the cursor, independent of the other helper's fetches.
      list: async (input?: { cursor?: string }) => {
        const index = input?.cursor === undefined ? 0 : Number(String(input.cursor).replace("p", ""))
        const page = pages[index] ?? []
        return { data: page, cursor: { next: index + 1 < pages.length ? `p${index + 1}` : null } }
      },
    },
    project: {
      current: async (input?: { location?: { directory: string } }) => ({
        id: "prj_x",
        directory: input?.location?.directory ?? "/cwd",
        canonical: "/main-clone",
      }),
    },
  }
  const frames = await Effect.runPromise(
    transcriptFrames(transcript, "/cwd", stub as unknown as Parameters<typeof transcriptFrames>[2], {
      type: "session.step.ended",
      created: 50,
      data: {
        sessionID: "ses_x",
        assistantMessageID: "msg_a",
        cost: 0.5,
        tokens: { input: 3, output: 4, reasoning: 1, cache: { read: 0, write: 0 } },
        finish: "stop",
      },
    }),
  )
  // Fresh adapter: the parent user is derived from the projection history
  // across the page boundary.
  const infoFrame = frames.find(
    (frame) => isRecord(frame.data) && isRecord((frame.data as Record<string, unknown>).info),
  )
  expect(infoFrame).toBeDefined()
  const info = Schema.decodeUnknownSync(SessionV1.Assistant)(
    (isRecord(infoFrame) ? (infoFrame.data as Record<string, unknown>).info : {}) as never,
  )
  expect(info.parentID === "msg_u2").toBe(true)
  // The projection's completed time is absent; the event envelope's observed
  // completion time fills the v1 field.
  expect(info.time.completed).toBe(50)
  // project.current.directory is the requested location's own checkout, not
  // the canonical main clone.
  expect(info.path.root).toBe("/cwd")
  expect(info.path.root === "/root").toBe(false)
  // Mixed content maps to per-kind producer ordinals: t0, r0, t1 — stable and
  // unique.
  const partIDs = frames
    .filter((frame) => isRecord(frame.data) && isRecord((frame.data as Record<string, unknown>).part))
    .map((frame) => ((frame.data as Record<string, unknown>).part as Record<string, unknown>).id as string)
  expect(partIDs).toEqual(["prt_msg_a_t0", "prt_msg_a_r0", "prt_msg_a_t1"])
})

function completedFrames(frames: unknown[], callID: string) {
  return eventFrames(frames, "message.part.updated").filter(
    (frame) =>
      isRecord((frame as Record<string, unknown>).data) &&
      isRecord(((frame as Record<string, unknown>).data as Record<string, unknown>).part) &&
      (((frame as Record<string, unknown>).data as Record<string, unknown>).part as Record<string, unknown>).callID ===
        callID &&
      (
        (((frame as Record<string, unknown>).data as Record<string, unknown>).part as Record<string, unknown>).state as
          | Record<string, unknown>
          | undefined
      )?.status === "completed",
  )
}

function response(frame: unknown, id: string) {
  return isRecord(frame) && frame.type === "response" && frame.id === id
}

let frameDump: (() => string) | undefined

async function awaitValue<T>(produce: () => Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await produce()
    if (value !== undefined) return value as T
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for relay frame; ${frameDump?.() ?? ""}`)
}

async function awaitLabeled<T>(label: string, produce: () => Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await produce()
    if (value !== undefined) return value as T
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for relay frame (${label}); ${frameDump?.() ?? ""}`)
}

async function awaitFrame<T = unknown>(values: unknown[], matches: (frame: unknown) => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = values.find((item) => matches(item))
    if (value !== undefined) return value as T
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for relay frame: ${JSON.stringify(values.slice(-12))}`)
}
