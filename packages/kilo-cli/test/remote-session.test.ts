import { expect, test } from "bun:test"
import { createClient } from "@kilocode/client"
import { Session } from "@opencode-ai/schema/session"
import { PermissionV1 } from "@opencode-ai/schema/v1/permission"
import { QuestionV1 } from "@opencode-ai/schema/v1/question"
import { Effect, Schema } from "effect"
import { mkdir, symlink } from "node:fs/promises"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { createRemoteSessionPlugin, type RemoteSessionClient } from "../src/remote-session"
import type { Layout } from "../src/paths"
import { fixture } from "./fixture"

test("translates supported v1 relay frames through a local WebSocket and isolated v2 host", async () => {
  await using input = await fixture()
  const opened = Promise.withResolvers<void>()
  const frames: unknown[] = []
  const connectionIDs: string[] = []
  let connections = 0
  let socket: { send(data: string): void; close(code?: number, reason?: string): void } | undefined
  const relay = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url)
      if (url.pathname !== "/api/user/cli") return new Response(null, { status: 404 })
      expect(url.searchParams.get("token")).toBe("fixture-bearer")
      expect(url.searchParams.get("connectionId")).toMatch(/^[0-9a-f-]{36}$/)
      connectionIDs.push(url.searchParams.get("connectionId") ?? "")
      if (server.upgrade(request)) return
      return new Response(null, { status: 400 })
    },
    websocket: {
      open(ws) {
        connections++
        socket = ws
        opened.resolve()
      },
      message(_ws, message) {
        frames.push(JSON.parse(String(message)))
      },
    },
  })
  const layout = interactiveLayout(path.join(input.directory, "remote-session-interactive"), input.home)
  let remoteClient: ReturnType<typeof createClient> | undefined
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
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
          const location = { directory: input.cwd }
          const session = yield* Effect.promise(() => client.session.create({ title: "Remote fixture", location }))
          yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
          yield* Effect.promise(() => opened.promise)
          yield* Effect.promise(() => waitFor(() => Promise.resolve(frames.length >= 1)))
          const heartbeat = frames.at(-1)
          expect(heartbeat).toMatchObject({
            type: "heartbeat",
            sessions: [{ id: session.id, title: "Remote fixture", status: "idle" }],
          })
          // v1 producer contract (ecccd1f remote-ws.ts): the capability the
          // deployed consumer gates its remote attachment path on rides every
          // heartbeat row. sessionClone is never advertised while cloud clone
          // is refused, keeping the consumer's clone gate fail-closed.
          expect(
            isRecord(heartbeat) && isRecord(heartbeat.capabilities) && heartbeat.capabilities.attachments === true,
          ).toBe(true)
          expect(
            frames.some(
              (frame) =>
                isRecord(frame) &&
                frame.type === "heartbeat" &&
                isRecord(frame.capabilities) &&
                "sessionClone" in frame.capabilities,
            ),
          ).toBe(false)
          socket?.send(JSON.stringify({ type: "subscribe", sessionId: session.id }))
          yield* Effect.promise(() => waitFor(() => Promise.resolve(frames.length >= 2)))

          yield* Effect.promise(() => mkdir(path.join(input.cwd, "remote-child")))
          const outside = path.join(input.directory, "remote-session-outside")
          yield* Effect.promise(() => mkdir(outside))
          yield* Effect.promise(() => symlink(outside, path.join(input.cwd, "remote-escape"), "dir"))
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "directories-1",
              command: "list_directories",
              data: { protocolVersion: 1 },
            }),
          )
          const directoryResponse = yield* Effect.promise(() =>
            awaitFrame(frames, (frame) => response(frame, "directories-1")),
          )
          expect(directoryResponse).toEqual({
            type: "response",
            id: "directories-1",
            result: {
              protocolVersion: 1,
              path: "",
              directories: expect.arrayContaining([{ name: "remote-child", path: "remote-child" }]),
            },
          })
          expect(
            isRecord(directoryResponse) &&
              isRecord(directoryResponse.result) &&
              Array.isArray(directoryResponse.result.directories) &&
              directoryResponse.result.directories.some(
                (directory) => isRecord(directory) && directory.name === "remote-escape",
              ),
          ).toBe(false)

          socket?.send(
            JSON.stringify({
              type: "command",
              id: "create-child-1",
              command: "create_session",
              data: { protocolVersion: 1, directory: "remote-child" },
            }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "create-child-1")))).toEqual(
            {
              type: "response",
              id: "create-child-1",
              error: "invalid create_session directory",
            },
          )
          expect((yield* Effect.promise(() => client.session.list({ directory: input.cwd }))).data).toHaveLength(1)

          socket?.send(
            JSON.stringify({
              type: "command",
              id: "create-1",
              command: "create_session",
              data: { protocolVersion: 1 },
            }),
          )
          const created = yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "create-1")))
          expect(created).toMatchObject({ type: "response", id: "create-1", result: { protocolVersion: 1 } })
          expect(isRecord(created) && isRecord(created.result) && typeof created.result.sessionID === "string").toBe(
            true,
          )

          socket?.send(
            JSON.stringify({
              type: "command",
              id: "send-1",
              command: "send_message",
              data: {
                sessionID: session.id,
                messageID: "msg_remote_1",
                parts: [{ type: "text", text: "relay prompt" }],
              },
            }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "send-1")))).toEqual({
            type: "response",
            id: "send-1",
            result: {},
          })
          const context = yield* Effect.promise(() => client.session.context({ sessionID: session.id }))
          expect(context.some((message) => message.type === "user" && message.text === "relay prompt")).toBe(true)

          socket?.send(
            JSON.stringify({
              type: "command",
              id: "commands-1",
              command: "list_commands",
              sessionId: session.id,
              data: { protocolVersion: 1 },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "commands-1"))),
          ).toMatchObject({
            type: "response",
            id: "commands-1",
            // The producer contract the deployed consumer gates its exit flow
            // on (v1 ecccd1f remote-command.ts always advertises it).
            result: { protocolVersion: 1, commands: expect.any(Array), canExitSession: true },
          })

          socket?.send(
            JSON.stringify({
              type: "command",
              id: "command-preflight-1",
              command: "send_command",
              sessionId: session.id,
              data: { protocolVersion: 1, command: "relay_missing_command", arguments: "" },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "command-preflight-1"))),
          ).toEqual({ type: "response", id: "command-preflight-1", error: "unknown slash command" })

          socket?.send(
            JSON.stringify({
              type: "system",
              event: "session.renamed",
              data: { sessionId: session.id, title: "Relay renamed" },
            }),
          )
          expect(
            yield* Effect.promise(() =>
              waitFor(async () => (await client.session.get({ sessionID: session.id })).title === "Relay renamed"),
            ),
          ).toBe(true)

          socket?.send(
            JSON.stringify({
              type: "command",
              id: "interrupt-1",
              command: "interrupt",
              sessionId: session.id,
              data: {},
            }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "interrupt-1")))).toEqual({
            type: "response",
            id: "interrupt-1",
            result: {},
          })
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "drop-foreign-1",
              command: "drop_queued_message",
              sessionId: session.id,
              data: { messageID: "msg_not_admitted_by_remote" },
            }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "drop-foreign-1")))).toEqual(
            {
              type: "response",
              id: "drop-foreign-1",
              error: "message not queued",
            },
          )

          const foreignDirectory = path.join(input.directory, "remote-session-foreign")
          yield* Effect.promise(() => mkdir(foreignDirectory, { recursive: true }))
          const foreign = yield* Effect.promise(() =>
            client.session.create({ title: "Foreign", location: { directory: foreignDirectory } }),
          )
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "interrupt-foreign-1",
              command: "interrupt",
              sessionId: foreign.id,
              data: {},
            }),
          )
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "interrupt-foreign-1"))),
          ).toEqual({ type: "response", id: "interrupt-foreign-1", error: "session unavailable" })

          const beforeReconnect = frames.length
          socket?.close()
          expect(yield* Effect.promise(() => waitFor(() => Promise.resolve(connections === 2)))).toBe(true)
          expect(connectionIDs).toHaveLength(2)
          expect(connectionIDs[0]).toBe(connectionIDs[1])
          expect(
            yield* Effect.promise(() =>
              waitFor(() =>
                Promise.resolve(
                  frames.slice(beforeReconnect).some((frame) => isRecord(frame) && frame.type === "heartbeat"),
                ),
              ),
            ),
          ).toBe(true)

          socket?.close(4401, "unauthorized")
          yield* Effect.promise(() => Bun.sleep(1_250))
          expect(connections).toBe(2)
        }),
      ),
    )
  } finally {
    await relay.stop(true)
  }
}, 30_000)

test("requires explicit secure relay authority", () => {
  expect(() =>
    createRemoteSessionPlugin({
      relayURL: "https://relay.example",
      bearerToken: "",
      client: () => {
        throw new Error("not reached")
      },
    }),
  ).toThrow("bearer token")
  expect(() =>
    createRemoteSessionPlugin({
      relayURL: "http://relay.example",
      bearerToken: "fixture",
      client: () => {
        throw new Error("not reached")
      },
    }),
  ).toThrow("HTTPS")
})

test("translates list_models with v1 catalog bounds and admits inline multipart attachments", async () => {
  await using input = await fixture()
  const opened = Promise.withResolvers<void>()
  const frames: unknown[] = []
  let socket: { send(data: string): void; close(code?: number, reason?: string): void } | undefined
  const relay = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url)
      if (url.pathname !== "/api/user/cli") return new Response(null, { status: 404 })
      expect(url.searchParams.get("token")).toBe("fixture-bearer")
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
  const layout = interactiveLayout(path.join(input.directory, "remote-session-models"), input.home)
  let remoteClient: ReturnType<typeof createClient> | undefined
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            content: JSON.stringify({
              model: "fixture-provider/chat",
              providers: {
                "fixture-provider": {
                  name: "Fixture Provider",
                  package: "aisdk:@ai-sdk/openai-compatible",
                  settings: { apiKey: "fixture-secret-settings-sentinel" },
                  headers: { "x-fixture-secret": "fixture-secret-header-sentinel" },
                  models: {
                    "vendor/chat": {
                      name: "Vendor Chat",
                      capabilities: { tools: true, input: ["text"], output: ["text"] },
                      limit: { context: 96_000, output: 16_000 },
                    },
                    chat: {
                      modelID: "vendor/chat",
                      name: "Chat Alias",
                      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
                      limit: { context: 100_000, output: 20_000 },
                    },
                    ordinary: {
                      name: "Ordinary Fixture Model",
                      settings: { apiKey: "fixture-secret-model-sentinel" },
                      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
                      limit: { context: 128_000, input: 100_000, output: 32_000 },
                      variants: [{ id: "high" }, { id: "low" }],
                    },
                    "fixture-mini": {
                      name: "Mini Fixture",
                      capabilities: { tools: false, input: ["text"], output: ["text"] },
                      limit: { context: 64_000, output: 8_000 },
                    },
                  },
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
          const location = { directory: input.cwd }
          yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
          yield* Effect.promise(() => opened.promise)
          yield* Effect.promise(() => waitFor(() => Promise.resolve(frames.length >= 1)))

          socket?.send(
            JSON.stringify({ type: "command", id: "models-1", command: "list_models", data: { protocolVersion: 1 } }),
          )
          // The host catalog also lists providers whose env keys are present in
          // the test environment, so the fixture provider is asserted exactly
          // while catalog-wide fields are asserted individually.
          const fixtureProvider = {
            id: "fixture-provider",
            name: "Fixture Provider",
            source: "custom",
            env: [],
            options: {},
            models: {
              "vendor/chat": {
                id: "vendor/chat",
                providerID: "fixture-provider",
                api: { id: "vendor/chat", url: "", npm: "" },
                name: "Vendor Chat",
                capabilities: {
                  toolcall: true,
                  input: { text: true, audio: false, image: false, video: false, pdf: false },
                  output: { text: true, audio: false, image: false, video: false, pdf: false },
                },
                cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                limit: { context: 96_000, output: 16_000 },
                status: "active",
                options: {},
                headers: {},
                release_date: "",
                variants: {},
              },
              ordinary: {
                id: "ordinary",
                providerID: "fixture-provider",
                api: { id: "ordinary", url: "", npm: "" },
                name: "Ordinary Fixture Model",
                capabilities: {
                  toolcall: true,
                  input: { text: true, audio: false, image: true, video: false, pdf: false },
                  output: { text: true, audio: false, image: false, video: false, pdf: false },
                },
                cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                limit: { context: 128_000, input: 100_000, output: 32_000 },
                status: "active",
                options: {},
                headers: {},
                release_date: "",
                variants: { high: {}, low: {} },
              },
              "fixture-mini": {
                id: "fixture-mini",
                providerID: "fixture-provider",
                api: { id: "fixture-mini", url: "", npm: "" },
                name: "Mini Fixture",
                capabilities: {
                  toolcall: false,
                  input: { text: true, audio: false, image: false, video: false, pdf: false },
                  output: { text: true, audio: false, image: false, video: false, pdf: false },
                },
                cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                limit: { context: 64_000, output: 8_000 },
                status: "active",
                options: {},
                headers: {},
                release_date: "",
                variants: {},
              },
              chat: {
                id: "chat",
                providerID: "fixture-provider",
                api: { id: "chat", url: "", npm: "" },
                name: "Chat Alias",
                capabilities: {
                  toolcall: true,
                  input: { text: true, audio: false, image: true, video: false, pdf: false },
                  output: { text: true, audio: false, image: false, video: false, pdf: false },
                },
                cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                limit: { context: 100_000, output: 20_000 },
                status: "active",
                options: {},
                headers: {},
                release_date: "",
                variants: {},
              },
            },
          }
          const modelsFrame = yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "models-1")))
          expect(modelsFrame).toMatchObject({ type: "response", id: "models-1" })
          const modelsResult = isRecord(modelsFrame) ? modelsFrame.result : undefined
          expect(isRecord(modelsResult) && modelsResult.truncated).toBe(false)
          expect(isRecord(modelsResult) && modelsResult.failed).toEqual([])
          expect(isRecord(modelsResult) && modelsResult.protocolVersion).toBe(1)
          expect(
            isRecord(modelsResult) && Array.isArray(modelsResult.all)
              ? modelsResult.all.find((provider) => isRecord(provider) && provider.id === "fixture-provider")
              : undefined,
          ).toEqual(fixtureProvider)
          expect(
            isRecord(modelsResult) && isRecord(modelsResult.default)
              ? modelsResult.default["fixture-provider"]
              : undefined,
          ).toBe("vendor/chat")
          expect(isRecord(modelsResult) && Array.isArray(modelsResult.connected)).toBe(true)
          expect(
            isRecord(modelsResult) && Array.isArray(modelsResult.connected)
              ? modelsResult.connected.includes("fixture-provider")
              : undefined,
          ).toBe(true)
          expect(isRecord(modelsResult) ? modelsResult.defaultModel : undefined).toEqual({
            providerID: "fixture-provider",
            modelID: "chat",
          })

          const selected = yield* Effect.promise(() =>
            client.session.create({
              location,
              model: { providerID: "fixture-provider", id: "fixture-mini", variant: "high" },
            }),
          )
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "models-2",
              command: "list_models",
              sessionId: selected.id,
              data: { protocolVersion: 1 },
            }),
          )
          const selectedFrame = yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "models-2")))
          expect(selectedFrame).toMatchObject({ type: "response", id: "models-2" })
          expect(
            isRecord(selectedFrame) && isRecord(selectedFrame.result) ? selectedFrame.result.currentModel : undefined,
          ).toEqual({ model: { providerID: "fixture-provider", modelID: "fixture-mini" }, variant: "high" })

          // Alias catalogs advertise the catalog identity (`chat`), not the
          // provider route target (`vendor/chat`), and the advertised id must
          // survive the relay create_session path. The model id below is
          // derived from the list_models response, not hardcoded. The prompt
          // roundtrip verifies durable admission only; model execution stays
          // out of scope (models: false).
          const catalogDefault =
            isRecord(modelsResult) && isRecord(modelsResult.defaultModel) ? modelsResult.defaultModel : undefined
          const advertisedProviderID =
            isRecord(catalogDefault) && typeof catalogDefault.providerID === "string" ? catalogDefault.providerID : ""
          const advertisedModelID =
            isRecord(catalogDefault) && typeof catalogDefault.modelID === "string" ? catalogDefault.modelID : ""
          expect(advertisedProviderID.length).toBeGreaterThan(0)
          expect(advertisedModelID.length).toBeGreaterThan(0)
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "create-alias-1",
              command: "create_session",
              data: { protocolVersion: 1, model: { providerID: advertisedProviderID, modelID: advertisedModelID } },
            }),
          )
          const aliasCreate = yield* Effect.promise(() =>
            awaitFrame(frames, (frame) => response(frame, "create-alias-1")),
          )
          expect(aliasCreate).toMatchObject({
            type: "response",
            id: "create-alias-1",
            result: { protocolVersion: 1 },
          })
          const aliasSessionID =
            isRecord(aliasCreate) && isRecord(aliasCreate.result) && typeof aliasCreate.result.sessionID === "string"
              ? aliasCreate.result.sessionID
              : ""
          expect(aliasSessionID.length).toBeGreaterThan(0)
          expect((yield* Effect.promise(() => client.session.get({ sessionID: aliasSessionID }))).model).toEqual({
            id: advertisedModelID,
            providerID: advertisedProviderID,
            variant: "default",
          })
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "models-3",
              command: "list_models",
              sessionId: aliasSessionID,
              data: { protocolVersion: 1 },
            }),
          )
          const aliasedFrame = yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "models-3")))
          expect(aliasedFrame).toMatchObject({ type: "response", id: "models-3" })
          expect(
            isRecord(aliasedFrame) && isRecord(aliasedFrame.result) ? aliasedFrame.result.currentModel : undefined,
          ).toEqual({ model: { providerID: advertisedProviderID, modelID: advertisedModelID } })
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "alias-prompt-1",
              command: "send_message",
              data: {
                sessionID: aliasSessionID,
                parts: [{ type: "text", text: "alias roundtrip prompt" }],
              },
            }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "alias-prompt-1")))).toEqual(
            { type: "response", id: "alias-prompt-1", result: {} },
          )
          expect(
            yield* Effect.promise(() =>
              waitFor(async () =>
                (await client.session.context({ sessionID: aliasSessionID })).some(
                  (message) => message.type === "user" && message.text === "alias roundtrip prompt",
                ),
              ),
            ),
          ).toBe(true)

          const serialized = JSON.stringify(frames)
          expect(serialized).not.toContain("fixture-secret-settings-sentinel")
          expect(serialized).not.toContain("fixture-secret-header-sentinel")
          expect(serialized).not.toContain("fixture-secret-model-sentinel")

          socket?.send(
            JSON.stringify({
              type: "command",
              id: "models-foreign-1",
              command: "list_models",
              sessionId: "ses_never_created_by_anyone",
              data: { protocolVersion: 1 },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "models-foreign-1"))),
          ).toEqual({ type: "response", id: "models-foreign-1", error: "session unavailable" })

          const session = yield* Effect.promise(() => client.session.create({ title: "Attachment target", location }))
          const payload = "fixture attachment bytes"
          const dataURL = `data:text/plain;base64,${btoa(payload)}`
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "attach-1",
              command: "send_message",
              data: {
                sessionID: session.id,
                messageID: "msg_attach_1",
                parts: [
                  { type: "text", text: "relay attachment" },
                  { type: "file", mime: "text/plain", filename: "notes.txt", url: dataURL },
                ],
              },
            }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "attach-1")))).toEqual({
            type: "response",
            id: "attach-1",
            result: {},
          })
          const users = () =>
            Effect.promise(async () =>
              (await client.session.context({ sessionID: session.id })).filter((message) => message.type === "user"),
            )
          const admitted = yield* users()
          const attached = admitted.find((message) => message.text === "relay attachment")
          expect(attached).toBeDefined()
          expect(attached?.files).toEqual([
            { data: btoa(payload), mime: "text/plain", source: { type: "inline" }, name: "notes.txt" },
          ])

          const before = admitted.length
          for (const [id, url] of [
            ["attach-remote-1", "https://fixture.invalid/pic.png"],
            ["attach-local-1", "file:///etc/hostname"],
          ] as const) {
            socket?.send(
              JSON.stringify({
                type: "command",
                id,
                command: "send_message",
                data: {
                  sessionID: session.id,
                  parts: [
                    { type: "text", text: "must not admit" },
                    { type: "file", mime: "application/octet-stream", filename: "attachment.bin", url },
                  ],
                },
              }),
            )
            expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, id)))).toEqual({
              type: "response",
              id,
              error: "send_message file parts must be inline data URLs",
            })
          }
          expect((yield* users()).some((message) => message.text === "must not admit")).toBe(false)
          expect((yield* users()).length).toBe(before)

          const oversized = Buffer.alloc(20 * 1024 * 1024 + 1, 7).toString("base64")
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "attach-oversized-1",
              command: "send_message",
              data: {
                sessionID: session.id,
                parts: [
                  { type: "text", text: "must not admit either" },
                  {
                    type: "file",
                    mime: "application/octet-stream",
                    filename: "attachment.bin",
                    url: `data:application/octet-stream;base64,${oversized}`,
                  },
                ],
              },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "attach-oversized-1"))),
          ).toEqual({ type: "response", id: "attach-oversized-1", error: "failed to admit message" })
          expect((yield* users()).some((message) => message.text === "must not admit either")).toBe(false)
          expect((yield* users()).length).toBe(before)
        }),
      ),
    )
  } finally {
    await relay.stop(true)
  }
}, 30_000)

test("cancels an admitted multipart message while its session is busy", async () => {
  await using input = await fixture()
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
  // Holds each chat completion open so the fixture session stays busy while
  // the relay admits and cancels a queued multipart prompt.
  const gateway = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/profile") return Response.json({ organizations: [], hasPersonalAccount: true })
      if (url.pathname === "/api/openrouter/models" || url.pathname === "/api/organizations/team/models") {
        return Response.json({
          data: [
            {
              id: "kilo-auto/slow",
              name: "Slow Fixture",
              context_length: 128_000,
              supported_parameters: ["tools"],
              opencode: { variants: { high: { reasoningEffort: "high" } } },
            },
          ],
        })
      }
      if (url.pathname === "/api/gateway/chat/completions") return new Promise<Response>(() => {})
      return new Response(null, { status: 404 })
    },
  })
  const layout = interactiveLayout(path.join(input.directory, "remote-session-busy"), input.home)
  let remoteClient: ReturnType<typeof createClient> | undefined
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            gateway: { server: gateway.url.origin },
            content: JSON.stringify({
              providers: { kilo: { package: "aisdk:@ai-sdk/openai-compatible", models: {} } },
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
          // The gateway's catalog discovery and the unscoped key connect both
          // activate plugins for the server's ambient directory, so the fixture
          // session lives there.
          const location = { directory: process.cwd() }
          yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
          yield* Effect.promise(() => client.integration.connect.key({ integrationID: "kilo", key: "fixture-only" }))
          expect(
            yield* Effect.promise(() =>
              waitFor(async () =>
                (await client.model.list({ location })).data.some((model) => model.id === "kilo-auto/slow"),
              ),
            ),
          ).toBe(true)
          const session = yield* Effect.promise(() =>
            client.session.create({
              title: "Busy fixture",
              location,
              model: { providerID: "kilo", id: "kilo-auto/slow", variant: "high" },
            }),
          )
          yield* Effect.promise(() => client.session.prompt({ sessionID: session.id, text: "hold the step open" }))
          expect(
            yield* Effect.promise(() => waitFor(async () => Boolean((await client.session.active())[session.id]))),
          ).toBe(true)

          const payload = "cancel attachment bytes"
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "cancel-admit-1",
              command: "send_message",
              data: {
                sessionID: session.id,
                messageID: "msg_cancel_1",
                parts: [
                  { type: "text", text: "cancel me before delivery" },
                  {
                    type: "file",
                    mime: "text/plain",
                    filename: "notes.txt",
                    url: `data:text/plain;base64,${btoa(payload)}`,
                  },
                ],
              },
            }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "cancel-admit-1")))).toEqual(
            { type: "response", id: "cancel-admit-1", result: {} },
          )

          socket?.send(
            JSON.stringify({
              type: "command",
              id: "cancel-drop-1",
              command: "drop_queued_message",
              sessionId: session.id,
              data: { messageID: "msg_cancel_1" },
            }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "cancel-drop-1")))).toEqual({
            type: "response",
            id: "cancel-drop-1",
            result: {},
          })

          socket?.send(
            JSON.stringify({
              type: "command",
              id: "cancel-drop-2",
              command: "drop_queued_message",
              sessionId: session.id,
              data: { messageID: "msg_cancel_1" },
            }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "cancel-drop-2")))).toEqual({
            type: "response",
            id: "cancel-drop-2",
            error: "message not queued",
          })

          expect(
            yield* Effect.promise(() =>
              waitFor(async () =>
                (await client.session.context({ sessionID: session.id })).some(
                  (message) => message.type === "user" && message.text === "hold the step open",
                ),
              ),
            ),
          ).toBe(true)
          expect(
            (yield* Effect.promise(() => client.session.context({ sessionID: session.id }))).some(
              (message) => message.type === "user" && message.text === "cancel me before delivery",
            ),
          ).toBe(false)
        }),
      ),
    )
  } finally {
    await relay.stop(true)
    await gateway.stop(true)
  }
}, 30_000)

// v1 exit_cli is session-detach (ecccd1f remote-sender.ts): the relay routes it
// to the CLI whose heartbeat owns the session, and both the ACK and the
// heartbeat that drops the session resolve it. The deployed consumer gates the
// command on the list_commands catalog's canExitSession flag.
test("exits a session by cancelling its prompt and detaching it from relay presence", async () => {
  await using input = await fixture()
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
  // Holds the chat completion open so the fixture session is busy when the
  // relay exit cancels its prompt.
  const gateway = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/profile") return Response.json({ organizations: [], hasPersonalAccount: true })
      if (url.pathname === "/api/openrouter/models" || url.pathname === "/api/organizations/team/models") {
        return Response.json({
          data: [
            {
              id: "kilo-auto/slow",
              name: "Slow Fixture",
              context_length: 128_000,
              supported_parameters: ["tools"],
              opencode: { variants: { high: { reasoningEffort: "high" } } },
            },
          ],
        })
      }
      if (url.pathname === "/api/gateway/chat/completions") return new Promise<Response>(() => {})
      return new Response(null, { status: 404 })
    },
  })
  const layout = interactiveLayout(path.join(input.directory, "remote-session-exit"), input.home)
  let remoteClient: ReturnType<typeof createClient> | undefined
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            gateway: { server: gateway.url.origin },
            content: JSON.stringify({
              providers: { kilo: { package: "aisdk:@ai-sdk/openai-compatible", models: {} } },
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
          const location = { directory: process.cwd() }
          yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
          yield* Effect.promise(() => client.integration.connect.key({ integrationID: "kilo", key: "fixture-only" }))
          expect(
            yield* Effect.promise(() =>
              waitFor(async () =>
                (await client.model.list({ location })).data.some((model) => model.id === "kilo-auto/slow"),
              ),
            ),
          ).toBe(true)
          const session = yield* Effect.promise(() =>
            client.session.create({
              title: "Exit fixture",
              location,
              model: { providerID: "kilo", id: "kilo-auto/slow", variant: "high" },
            }),
          )
          yield* Effect.promise(() => client.session.prompt({ sessionID: session.id, text: "hold the step open" }))
          expect(
            yield* Effect.promise(() => waitFor(async () => Boolean((await client.session.active())[session.id]))),
          ).toBe(true)
          const advertised = () =>
            frames.some(
              (frame) =>
                isRecord(frame) &&
                frame.type === "heartbeat" &&
                Array.isArray(frame.sessions) &&
                frame.sessions.some((item) => isRecord(item) && item.id === session.id),
            )
          expect(yield* Effect.promise(() => waitFor(async () => advertised()))).toBe(true)

          // The relay forwards exit_cli only with exactly { protocolVersion: 1 }
          // and a sessionId; the adapter refuses anything else without touching
          // presence.
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "exit-invalid-1",
              command: "exit_cli",
              sessionId: session.id,
              data: { protocolVersion: 2 },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "exit-invalid-1"))),
          ).toEqual({ type: "response", id: "exit-invalid-1", error: "invalid exit_cli command" })

          const foreignDirectory = path.join(input.directory, "remote-session-exit-foreign")
          yield* Effect.promise(() => mkdir(foreignDirectory, { recursive: true }))
          const foreign = yield* Effect.promise(() =>
            client.session.create({ title: "Foreign exit", location: { directory: foreignDirectory } }),
          )
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "exit-foreign-1",
              command: "exit_cli",
              sessionId: foreign.id,
              data: { protocolVersion: 1 },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "exit-foreign-1"))),
          ).toEqual({ type: "response", id: "exit-foreign-1", error: "session not owned by this CLI" })
          // The refusal left the busy session advertised.
          expect(yield* Effect.promise(() => waitFor(async () => advertised()))).toBe(true)
          expect(
            yield* Effect.promise(() => waitFor(async () => Boolean((await client.session.active())[session.id]))),
          ).toBe(true)

          socket?.send(
            JSON.stringify({
              type: "command",
              id: "exit-1",
              command: "exit_cli",
              sessionId: session.id,
              data: { protocolVersion: 1 },
            }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "exit-1")))).toEqual({
            type: "response",
            id: "exit-1",
            result: {},
          })

          // Step 3 of the v1 contract: the session's active prompt is cancelled,
          // so no "still working" state survives the exit.
          expect(
            yield* Effect.promise(() => waitFor(async () => !(await client.session.active())[session.id])),
          ).toBe(true)

          // Detach = presence removal: the heartbeat that follows the detach
          // no longer advertises the session, which is what the deployed relay
          // reads as ownership release. Every heartbeat before the exit
          // contained it, so the first omitting frame is the fence.
          expect(
            yield* Effect.promise(() =>
              waitFor(async () => {
                const lastAdvertised = frames.reduce<number>(
                  (last, frame, index) =>
                    isRecord(frame) &&
                    frame.type === "heartbeat" &&
                    Array.isArray(frame.sessions) &&
                    frame.sessions.some((item) => isRecord(item) && item.id === session.id)
                      ? index
                      : last,
                  -1,
                )
                return frames.some(
                  (frame, index) =>
                    index > lastAdvertised &&
                    isRecord(frame) &&
                    frame.type === "heartbeat" &&
                    isRecord(frame.capabilities) &&
                    frame.capabilities.attachments === true &&
                    Array.isArray(frame.sessions) &&
                    !frame.sessions.some((item) => isRecord(item) && item.id === session.id),
                )
              }),
            ),
          ).toBe(true)

          // Detach is not deletion: the session stays resolvable through the
          // public client, and a second exit refuses because the adapter no
          // longer advertises it (v1's hasSession ownership rule).
          expect((yield* Effect.promise(() => client.session.get({ sessionID: session.id }))).id).toBe(session.id)
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "exit-2",
              command: "exit_cli",
              sessionId: session.id,
              data: { protocolVersion: 1 },
            }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "exit-2")))).toEqual({
            type: "response",
            id: "exit-2",
            error: "session not owned by this CLI",
          })
        }),
      ),
    )
  } finally {
    await relay.stop(true)
    await gateway.stop(true)
  }
}, 30_000)

// Scripted loopback model (agent-policy fixture pattern): tool calls keyed on
// transcript markers, plain text after any tool result or for title prompts.
function relayModelServer() {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body = (await request.json()) as { messages: Array<{ role: string; content?: unknown }> }
      const transcript = JSON.stringify(body.messages)
      const tool =
        body.messages.at(-1)?.role === "tool" || transcript.includes("title generator")
          ? undefined
          : transcript.includes("relay question reject probe")
            ? {
                name: "question",
                arguments: JSON.stringify({
                  questions: [
                    {
                      question: "Abort this run?",
                      header: "Cancel",
                      options: [{ label: "dismiss", description: "Dismiss the question" }],
                    },
                  ],
                }),
              }
            : transcript.includes("relay question probe")
              ? {
                  name: "question",
                  arguments: JSON.stringify({
                    questions: [
                      {
                        question: "Which environment should we deploy to?",
                        header: "Deploy",
                        options: [
                          { label: "staging", description: "Staging cluster" },
                          { label: "prod", description: "Production cluster" },
                        ],
                      },
                      {
                        question: "Which clusters need the change?",
                        header: "Clusters",
                        options: [
                          { label: "us-east", description: "US east cluster" },
                          { label: "eu-west", description: "EU west cluster" },
                        ],
                        multiple: true,
                      },
                    ],
                  }),
                }
              : transcript.includes("relay permission probe")
                ? { name: "shell", arguments: JSON.stringify({ command: "echo relay-ok" }) }
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

const permissionAskFrames = (frames: unknown[], requestID: string) =>
  frames.filter(
    (frame) =>
      isRecord(frame) &&
      frame.type === "event" &&
      frame.event === "permission.asked" &&
      isRecord(frame.data) &&
      frame.data.id === requestID,
  )

const questionEventFrames = (frames: readonly unknown[], event: string, formID: string) =>
  frames.filter(
    (frame) =>
      isRecord(frame) &&
      frame.type === "event" &&
      frame.event === event &&
      isRecord(frame.data) &&
      frame.data.id === formID,
  )

test("translates permission asks and enforces the interactive gate through a real host", async () => {
  await using input = await fixture()
  const model = relayModelServer()
  const opened = Promise.withResolvers<void>()
  const frames: unknown[] = []
  let connections = 0
  const byConnection = new Map<string, { send(data: string): void; close(code?: number, reason?: string): void }>()
  let firstConnectionId = ""
  const relay = Bun.serve<{ connectionId: string }>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url)
      if (url.pathname !== "/api/user/cli") return new Response(null, { status: 404 })
      if (server.upgrade(request, { data: { connectionId: url.searchParams.get("connectionId") ?? "" } })) return
      return new Response(null, { status: 400 })
    },
    websocket: {
      open(ws) {
        connections++
        byConnection.set(ws.data.connectionId, {
          send: (data) => ws.send(data),
          close: (code, reason) => ws.close(code, reason),
        })
        if (!firstConnectionId) firstConnectionId = ws.data.connectionId
        opened.resolve()
      },
      message(ws, message) {
        frames.push(JSON.parse(String(message)))
      },
    },
  })
  const location = { directory: process.cwd() }
  const layout = interactiveLayout(path.join(input.directory, "remote-session-permissions"), input.home)
  // The adapter is activated for the server's ambient directory, so its
  // connections all carry the first observed connectionId. Every session
  // command below is sent on that adapter's current socket.
  const sendRelay = (data: unknown) => byConnection.get(firstConnectionId)?.send(JSON.stringify(data))
  let remoteClient: ReturnType<typeof createClient> | undefined
  // Deterministic client-wrapper controls for replay resilience: a failing
  // form list and a delayed permission list.
  let failFormList = false
  let delayPermissionList = false
  const strip = { domain: "none" as "none" | "form" | "permission" }
  const delayGate = Promise.withResolvers<void>()
  let wrappedClient: ReturnType<typeof createClient> | undefined
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            content: JSON.stringify({
              model: "fixture/chat",
              permissions: [{ action: "shell", resource: "*", effect: "ask" }],
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
                  if (!wrappedClient) {
                    const real = remoteClient
                    wrappedClient = {
                      ...real,
                      // Namespace absence is dynamic: stripping a domain
                      // models a host without it, distinct from a failing
                      // list.
                      get permission() {
                        if (strip.domain === "permission") return undefined
                        return {
                          ...real.permission,
                          request: {
                            ...real.permission.request,
                            list: async (input?: Parameters<typeof real.permission.request.list>[0]) => {
                              if (delayPermissionList) await delayGate.promise
                              return real.permission.request.list(input)
                            },
                          },
                        }
                      },
                      get form() {
                        if (strip.domain === "form") return undefined
                        return {
                          ...real.form,
                          request: {
                            ...real.form.request,
                            list: async (input?: Parameters<typeof real.form.request.list>[0]) => {
                              if (failFormList) throw new Error("fixture form list failure")
                              return real.form.request.list(input)
                            },
                          },
                        }
                      },
                    } as unknown as ReturnType<typeof createClient>
                  }
                  return wrappedClient
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
              title: "Relay permissions",
              location,
              model: { providerID: "fixture", id: "chat" },
            }),
          )
          yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
          yield* Effect.promise(() => opened.promise)
          sendRelay({ type: "subscribe", sessionId: session.id })

          // A sensitive approval is refused without the explicit human bit and
          // stays pending; the interactive reply resolves it.
          const sensitive = yield* Effect.promise(() =>
            client.permission.create({
              sessionID: session.id,
              action: "shell",
              resources: ["git push *"],
              metadata: { skillShell: true },
            }),
          )
          expect(sensitive.effect).toBe("ask")
          const askedFrame = yield* Effect.promise(() =>
            awaitFrame(frames, (frame) => permissionAskFrames([frame], sensitive.id).length > 0),
          )
          expect(isRecord(askedFrame) && askedFrame.parentSessionId).toBeUndefined()
          const decoded = Schema.decodeUnknownSync(PermissionV1.Request)(
            (isRecord(askedFrame) ? askedFrame.data : {}) as never,
          )
          expect(decoded.id === sensitive.id).toBe(true)
          expect(decoded.sessionID === session.id).toBe(true)
          expect(decoded.permission).toBe("shell")
          expect(decoded.patterns).toEqual(["git push *"])
          expect(decoded.metadata).toEqual({ skillShell: true })
          expect(decoded.always).toEqual([])
          sendRelay({
            type: "command",
            id: "sensitive-refused-1",
            command: "permission_respond",
            sessionId: session.id,
            data: { requestID: sensitive.id, reply: "once" },
          })
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "sensitive-refused-1"))),
          ).toEqual({
            type: "response",
            id: "sensitive-refused-1",
            error: "sensitive permission approval requires an interactive human reply",
          })
          expect(
            (yield* Effect.promise(() => client.permission.list({ sessionID: session.id }))).some(
              (request) => request.id === sensitive.id,
            ),
          ).toBe(true)
          sendRelay({
            type: "command",
            id: "sensitive-approved-1",
            command: "permission_respond",
            sessionId: session.id,
            data: { requestID: sensitive.id, reply: "once", interactive: true },
          })
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "sensitive-approved-1"))),
          ).toEqual({ type: "response", id: "sensitive-approved-1", result: {} })
          expect(
            (yield* Effect.promise(() => client.permission.list({ sessionID: session.id }))).some(
              (request) => request.id === sensitive.id,
            ),
          ).toBe(false)

          // An ordinary request needs no interactive bit.
          const ordinary = yield* Effect.promise(() =>
            client.permission.create({ sessionID: session.id, action: "shell", resources: ["git status"] }),
          )
          yield* Effect.promise(() =>
            awaitFrame(frames, (frame) => permissionAskFrames([frame], ordinary.id).length > 0),
          )
          sendRelay({
            type: "command",
            id: "ordinary-1",
            command: "permission_respond",
            sessionId: session.id,
            data: { requestID: ordinary.id, reply: "once" },
          })
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "ordinary-1")))).toEqual({
            type: "response",
            id: "ordinary-1",
            result: {},
          })
          expect(
            (yield* Effect.promise(() => client.permission.list({ sessionID: session.id }))).some(
              (request) => request.id === ordinary.id,
            ),
          ).toBe(false)

          // Unsubscribed sessions are not forwarded: a pending request raised
          // after unsubscribe only surfaces through subscribe replay.
          sendRelay({ type: "unsubscribe", sessionId: session.id })
          const replayed = yield* Effect.promise(() =>
            client.permission.create({
              sessionID: session.id,
              action: "shell",
              resources: ["git push *"],
              metadata: { skillShell: true },
            }),
          )
          yield* Effect.promise(() => Bun.sleep(200))
          expect(permissionAskFrames(frames, replayed.id)).toHaveLength(0)
          sendRelay({ type: "subscribe", sessionId: session.id })
          yield* Effect.promise(() =>
            awaitFrame(frames, (frame) => permissionAskFrames([frame], replayed.id).length > 0),
          )

          // Foreign-location sessions are neither replayed nor answerable.
          const foreignDirectory = path.join(input.directory, "remote-session-permissions-foreign")
          yield* Effect.promise(() => mkdir(foreignDirectory, { recursive: true }))
          const foreign = yield* Effect.promise(() =>
            client.session.create({ title: "Foreign permissions", location: { directory: foreignDirectory } }),
          )
          // external_directory asks come from the native default agent rules,
          // so the foreign location needs no shared config to raise a pending
          // request. Activating the plugin there would create a second adapter.
          const foreignRequest = yield* Effect.promise(() =>
            client.permission.create({ sessionID: foreign.id, action: "external_directory", resources: ["/etc"] }),
          )
          expect(foreignRequest.effect).toBe("ask")
          yield* Effect.promise(() => Bun.sleep(200))
          expect(permissionAskFrames(frames, foreignRequest.id)).toHaveLength(0)
          sendRelay({
            type: "command",
            id: "foreign-reply-1",
            command: "permission_respond",
            sessionId: foreign.id,
            data: { requestID: foreignRequest.id, reply: "once" },
          })
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "foreign-reply-1"))),
          ).toEqual({ type: "response", id: "foreign-reply-1", error: "permission request not found" })

          // A reply naming a different session than the request's own is
          // refused, and the request stays pending on its own session.
          const other = yield* Effect.promise(() =>
            client.session.create({ title: "Other ambient permissions", location }),
          )
          const mismatch = yield* Effect.promise(() =>
            client.permission.create({ sessionID: other.id, action: "external_directory", resources: ["/etc"] }),
          )
          expect(mismatch.effect).toBe("ask")
          sendRelay({
            type: "command",
            id: "mismatch-reply-1",
            command: "permission_respond",
            sessionId: session.id,
            data: { requestID: mismatch.id, reply: "once" },
          })
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "mismatch-reply-1"))),
          ).toEqual({ type: "response", id: "mismatch-reply-1", error: "permission request not found" })
          expect(
            (yield* Effect.promise(() => client.permission.list({ sessionID: other.id }))).some(
              (request) => request.id === mismatch.id,
            ),
          ).toBe(true)

          // Reconnect replays pending requests for the retained subscription.
          // The foreign location runs its own adapter, so the replacement
          // socket is identified by the adapter's retained connectionId.
          const beforeReconnect = frames.length
          const beforeSocket = byConnection.get(firstConnectionId)
          beforeSocket?.close()
          expect(
            yield* Effect.promise(() =>
              waitFor(async () =>
                Promise.resolve(
                  byConnection.get(firstConnectionId) !== undefined &&
                    byConnection.get(firstConnectionId) !== beforeSocket,
                ),
              ),
            ),
          ).toBe(true)
          yield* Effect.promise(() =>
            waitFor(async () =>
              Promise.resolve(
                frames.slice(beforeReconnect).some((frame) => permissionAskFrames([frame], replayed.id).length > 0),
              ),
            ),
          )
          expect(permissionAskFrames(frames, replayed.id).length).toBeGreaterThanOrEqual(2)

          // A duplicate active subscribe (the relay resends on reconnect) must
          // not replay the pending snapshot again.
          const afterFirstReplay = permissionAskFrames(frames, replayed.id).length
          sendRelay({ type: "subscribe", sessionId: session.id })
          yield* Effect.promise(() => Bun.sleep(300))
          expect(permissionAskFrames(frames, replayed.id).length).toBe(afterFirstReplay)

          // Same-location descendants replay with the subscribed root as
          // parentSessionId. The pending request is raised while the root is
          // unsubscribed so no live frame can mask the replay.
          sendRelay({ type: "unsubscribe", sessionId: session.id })
          const childExport = yield* Effect.promise(() => client.session.export({ sessionID: session.id }))
          const child = yield* Effect.promise(() =>
            client.session.import({
              ...childExport,
              info: { ...childExport.info, id: Session.ID.create(), parentID: session.id },
              location,
            }),
          )
          const childRequest = yield* Effect.promise(() =>
            client.permission.create({ sessionID: child.id, action: "external_directory", resources: ["/etc"] }),
          )
          expect(childRequest.effect).toBe("ask")
          yield* Effect.promise(() => Bun.sleep(200))
          expect(permissionAskFrames(frames, childRequest.id)).toHaveLength(0)
          sendRelay({ type: "subscribe", sessionId: session.id })
          const childReplayFrame = yield* Effect.promise(() =>
            awaitFrame(frames, (frame) => permissionAskFrames([frame], childRequest.id).length > 0),
          )
          expect(isRecord(childReplayFrame) && childReplayFrame.parentSessionId === session.id).toBe(true)

          // The original P1 consumer mismatch: the deployed consumer sends
          // child-ask commands with the subscription root as sessionId. The
          // adapter must resolve and answer the child-owned request through
          // the root-id commands.
          sendRelay({
            type: "command",
            id: "child-permission-once-1",
            command: "permission_respond",
            sessionId: session.id,
            data: { requestID: childRequest.id, reply: "once" },
          })
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "child-permission-once-1"))),
          ).toEqual({ type: "response", id: "child-permission-once-1", result: {} })
          expect(
            (yield* Effect.promise(() => client.permission.list({ sessionID: child.id }))).some(
              (request) => request.id === childRequest.id,
            ),
          ).toBe(false)
          const childReject = yield* Effect.promise(() =>
            client.permission.create({ sessionID: child.id, action: "external_directory", resources: ["/etc/hosts"] }),
          )
          expect(childReject.effect).toBe("ask")
          yield* Effect.promise(() =>
            awaitFrame(frames, (frame) => permissionAskFrames([frame], childReject.id).length > 0),
          )
          sendRelay({
            type: "command",
            id: "child-permission-reject-1",
            command: "permission_respond",
            sessionId: session.id,
            data: { requestID: childReject.id, reply: "reject" },
          })
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "child-permission-reject-1"))),
          ).toEqual({ type: "response", id: "child-permission-reject-1", result: {} })
          expect(
            (yield* Effect.promise(() => client.permission.list({ sessionID: child.id }))).some(
              (request) => request.id === childReject.id,
            ),
          ).toBe(false)
          const childQuestionForm = yield* Effect.promise(() =>
            client.form.create({
              sessionID: child.id,
              title: "Child question",
              metadata: { kind: "question" },
              fields: [
                {
                  key: "choice",
                  title: "Choice",
                  description: "Answer the child question?",
                  type: "string",
                  required: true,
                  custom: false,
                  options: [{ value: "yes", label: "yes" }],
                },
              ],
            }),
          )
          yield* Effect.promise(() =>
            awaitFrame(
              frames,
              (frame) => questionEventFrames([frame], "question.asked", childQuestionForm.id).length > 0,
            ),
          )
          sendRelay({
            type: "command",
            id: "child-question-reply-1",
            command: "question_reply",
            sessionId: session.id,
            data: { requestID: childQuestionForm.id, answers: [["yes"]] },
          })
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "child-question-reply-1"))),
          ).toEqual({ type: "response", id: "child-question-reply-1", result: {} })
          expect(
            (yield* Effect.promise(() => client.form.state({ sessionID: child.id, formID: childQuestionForm.id })))
              .status,
          ).toBe("answered")
          const childRejectedForm = yield* Effect.promise(() =>
            client.form.create({
              sessionID: child.id,
              title: "Child reject",
              metadata: { kind: "question" },
              fields: [
                {
                  key: "choice",
                  title: "Reject",
                  description: "Reject this child question?",
                  type: "string",
                  required: true,
                  custom: false,
                  options: [{ value: "yes", label: "yes" }],
                },
              ],
            }),
          )
          sendRelay({
            type: "command",
            id: "child-question-reject-1",
            command: "question_reject",
            sessionId: session.id,
            data: { requestID: childRejectedForm.id },
          })
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "child-question-reject-1"))),
          ).toEqual({ type: "response", id: "child-question-reject-1", result: {} })
          expect(
            (yield* Effect.promise(() => client.form.state({ sessionID: child.id, formID: childRejectedForm.id })))
              .status,
          ).toBe("cancelled")
          // An unrelated same-location session is not a descendant of the
          // command root: refused with its pending unchanged.
          const unrelated = yield* Effect.promise(() =>
            client.session.create({ title: "Unrelated permissions", location }),
          )
          const unrelatedRequest = yield* Effect.promise(() =>
            client.permission.create({ sessionID: unrelated.id, action: "external_directory", resources: ["/etc"] }),
          )
          expect(unrelatedRequest.effect).toBe("ask")
          sendRelay({
            type: "command",
            id: "unrelated-reply-1",
            command: "permission_respond",
            sessionId: session.id,
            data: { requestID: unrelatedRequest.id, reply: "once" },
          })
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "unrelated-reply-1"))),
          ).toEqual({ type: "response", id: "unrelated-reply-1", error: "permission request not found" })
          expect(
            (yield* Effect.promise(() => client.permission.list({ sessionID: unrelated.id }))).some(
              (request) => request.id === unrelatedRequest.id,
            ),
          ).toBe(true)

          // A moved subscribed root invalidates stale membership: descendants
          // left behind must not forward through it, on events or on reconnect
          // replay.
          const moveTarget = path.join(input.directory, "remote-session-permissions-moved")
          yield* Effect.promise(() => mkdir(moveTarget, { recursive: true }))
          yield* Effect.promise(() => client.session.move({ sessionID: session.id, directory: moveTarget }))
          const afterMove = yield* Effect.promise(() =>
            client.permission.create({ sessionID: child.id, action: "external_directory", resources: ["/etc/hosts"] }),
          )
          expect(afterMove.effect).toBe("ask")
          yield* Effect.promise(() => Bun.sleep(300))
          expect(permissionAskFrames(frames, afterMove.id)).toHaveLength(0)
          const beforeMovedReconnect = frames.length
          const beforeMovedSocket = byConnection.get(firstConnectionId)
          beforeMovedSocket?.close()
          expect(
            yield* Effect.promise(() =>
              waitFor(async () =>
                Promise.resolve(
                  byConnection.get(firstConnectionId) !== undefined &&
                    byConnection.get(firstConnectionId) !== beforeMovedSocket,
                ),
              ),
            ),
          ).toBe(true)
          yield* Effect.promise(() => Bun.sleep(400))
          expect(permissionAskFrames(frames, afterMove.id)).toHaveLength(0)
          expect(permissionAskFrames(frames, childRequest.id).length).toBe(1)

          // A moved intermediate between the subscribed root and a descendant
          // drops the leaf on live events and replay alike: the leaf stays in
          // the adapter's location while its intermediate moves away.
          const intermediateExport = yield* Effect.promise(() => client.session.export({ sessionID: child.id }))
          const intermediate = yield* Effect.promise(() =>
            client.session.import({
              ...intermediateExport,
              info: { ...intermediateExport.info, id: Session.ID.create(), parentID: child.id },
              location,
            }),
          )
          const leafExport = yield* Effect.promise(() => client.session.export({ sessionID: intermediate.id }))
          const leaf = yield* Effect.promise(() =>
            client.session.import({
              ...leafExport,
              info: { ...leafExport.info, id: Session.ID.create(), parentID: intermediate.id },
              location,
            }),
          )
          const intermediateTarget = path.join(input.directory, "remote-session-permissions-intermediate")
          yield* Effect.promise(() => mkdir(intermediateTarget, { recursive: true }))
          yield* Effect.promise(() =>
            client.session.move({ sessionID: intermediate.id, directory: intermediateTarget }),
          )
          const leafRequest = yield* Effect.promise(() =>
            client.permission.create({ sessionID: leaf.id, action: "external_directory", resources: ["/etc"] }),
          )
          expect(leafRequest.effect).toBe("ask")
          yield* Effect.promise(() => Bun.sleep(300))
          expect(permissionAskFrames(frames, leafRequest.id)).toHaveLength(0)
          // A root-ID command addressed to the moved intermediate cannot
          // reach the leaf: the lineage proof fails at the moved hop and the
          // leaf's pending stays unchanged.
          sendRelay({
            type: "command",
            id: "moved-lineage-reply-1",
            command: "permission_respond",
            sessionId: intermediate.id,
            data: { requestID: leafRequest.id, reply: "once" },
          })
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "moved-lineage-reply-1"))),
          ).toEqual({ type: "response", id: "moved-lineage-reply-1", error: "permission request not found" })
          expect(
            (yield* Effect.promise(() => client.permission.list({ sessionID: leaf.id }))).some(
              (request) => request.id === leafRequest.id,
            ),
          ).toBe(true)

          // A terminal resolving during a replay invalidates the snapshot: no
          // replayed asked may follow the processed terminal. A dedicated
          // session isolates the reject cascade (a reject declines all
          // same-session siblings) from the later race assertions.
          const terminalSession = yield* Effect.promise(() =>
            client.session.create({ title: "Terminal during replay", location }),
          )
          const terminalPending = yield* Effect.promise(() =>
            client.permission.create({
              sessionID: terminalSession.id,
              action: "external_directory",
              resources: ["/etc"],
            }),
          )
          expect(terminalPending.effect).toBe("ask")
          sendRelay({ type: "subscribe", sessionId: terminalSession.id })
          yield* Effect.promise(() =>
            client.permission.reply({ sessionID: terminalSession.id, requestID: terminalPending.id, reply: "reject" }),
          )
          yield* Effect.promise(() => Bun.sleep(400))
          expect(permissionAskFrames(frames, terminalPending.id)).toHaveLength(0)
          expect(
            (yield* Effect.promise(() => client.permission.list({ sessionID: terminalSession.id }))).some(
              (request) => request.id === terminalPending.id,
            ),
          ).toBe(false)

          // Terminal invalidation is per item: resolving one of two same-
          // session pendings during the replay window suppresses only that
          // item; the sibling still replays and stays answerable.
          const siblingSession = yield* Effect.promise(() =>
            client.session.create({ title: "Sibling pendings", location }),
          )
          const resolvedSibling = yield* Effect.promise(() =>
            client.permission.create({
              sessionID: siblingSession.id,
              action: "external_directory",
              resources: ["/etc"],
            }),
          )
          const survivingSibling = yield* Effect.promise(() =>
            client.permission.create({
              sessionID: siblingSession.id,
              action: "external_directory",
              resources: ["/etc/hosts"],
            }),
          )
          expect(resolvedSibling.effect).toBe("ask")
          expect(survivingSibling.effect).toBe("ask")
          sendRelay({ type: "subscribe", sessionId: siblingSession.id })
          yield* Effect.promise(() =>
            client.permission.reply({ sessionID: siblingSession.id, requestID: resolvedSibling.id, reply: "once" }),
          )
          yield* Effect.promise(() => Bun.sleep(400))
          expect(permissionAskFrames(frames, resolvedSibling.id)).toHaveLength(0)
          expect(permissionAskFrames(frames, survivingSibling.id).length).toBeGreaterThanOrEqual(1)
          sendRelay({
            type: "command",
            id: "sibling-answer-1",
            command: "permission_respond",
            sessionId: siblingSession.id,
            data: { requestID: survivingSibling.id, reply: "once" },
          })
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "sibling-answer-1"))),
          ).toEqual({ type: "response", id: "sibling-answer-1", result: {} })
          expect(
            (yield* Effect.promise(() => client.permission.list({ sessionID: siblingSession.id }))).some(
              (request) => request.id === survivingSibling.id,
            ),
          ).toBe(false)

          // Domain independence: a failing form list must not suppress the
          // permission replay, and recovery replays the form afterwards.
          sendRelay({ type: "unsubscribe", sessionId: siblingSession.id })
          failFormList = true
          const domainProbe = yield* Effect.promise(() =>
            client.permission.create({
              sessionID: siblingSession.id,
              action: "external_directory",
              resources: ["/etc"],
            }),
          )
          expect(domainProbe.effect).toBe("ask")
          const domainForm = yield* Effect.promise(() =>
            client.form.create({
              sessionID: siblingSession.id,
              title: "Domain probe",
              metadata: { kind: "question" },
              fields: [
                {
                  key: "choice",
                  title: "Probe",
                  description: "Probe the form domain?",
                  type: "string",
                  required: true,
                  custom: false,
                  options: [{ value: "yes", label: "yes" }],
                },
              ],
            }),
          )
          sendRelay({ type: "subscribe", sessionId: siblingSession.id })
          yield* Effect.promise(() =>
            awaitFrame(frames, (frame) => permissionAskFrames([frame], domainProbe.id).length > 0),
          )
          yield* Effect.promise(() => Bun.sleep(300))
          expect(questionEventFrames(frames, "question.asked", domainForm.id)).toHaveLength(0)
          failFormList = false
          sendRelay({ type: "unsubscribe", sessionId: siblingSession.id })
          sendRelay({ type: "subscribe", sessionId: siblingSession.id })
          yield* Effect.promise(() =>
            awaitFrame(frames, (frame) => questionEventFrames([frame], "question.asked", domainForm.id).length > 0),
          )

          // Absent-namespace gating, live and replay: with the form namespace
          // absent, permission frames still forward, replay, and answer while
          // question forms emit zero frames; with the permission namespace
          // absent, the mirror holds and the form stays answerable. A later
          // supported live frame is the deterministic barrier proving the
          // adapter processed past the dropped unsupported event.
          sendRelay({ type: "unsubscribe", sessionId: siblingSession.id })
          strip.domain = "form"
          const permissionOnlyProbe = yield* Effect.promise(() =>
            client.permission.create({
              sessionID: siblingSession.id,
              action: "external_directory",
              resources: ["/etc"],
            }),
          )
          expect(permissionOnlyProbe.effect).toBe("ask")
          const strippedForm = yield* Effect.promise(() =>
            client.form.create({
              sessionID: siblingSession.id,
              title: "Stripped form",
              metadata: { kind: "websearch.provider" },
              fields: [
                {
                  key: "choice",
                  title: "Stripped",
                  description: "Unsupported control pending while the form domain is stripped",
                  type: "string",
                  required: true,
                  custom: false,
                  options: [{ value: "yes", label: "yes" }],
                },
              ],
            }),
          )
          sendRelay({ type: "subscribe", sessionId: siblingSession.id })
          yield* Effect.promise(() =>
            awaitFrame(frames, (frame) => permissionAskFrames([frame], permissionOnlyProbe.id).length > 0),
          )
          yield* Effect.promise(() => Bun.sleep(300))
          expect(questionEventFrames(frames, "question.asked", strippedForm.id)).toHaveLength(0)
          // New live asks while subscribed: a supported permission forwards,
          // an unsupported question form drops — the barrier frame for the
          // later supported permission proves the unsupported form.created was
          // already processed when the zero-count is read.
          const livePermissionProbe = yield* Effect.promise(() =>
            client.permission.create({
              sessionID: siblingSession.id,
              action: "external_directory",
              resources: ["/etc/hosts"],
            }),
          )
          const unsupportedForm = yield* Effect.promise(() =>
            client.form.create({
              sessionID: siblingSession.id,
              title: "Unsupported live",
              metadata: { kind: "websearch.provider" },
              fields: [
                {
                  key: "choice",
                  title: "Unsupported",
                  description: "Unsupported control while the form domain is stripped",
                  type: "string",
                  required: true,
                  custom: false,
                  options: [{ value: "yes", label: "yes" }],
                },
              ],
            }),
          )
          const barrierPermission = yield* Effect.promise(() =>
            client.permission.create({
              sessionID: siblingSession.id,
              action: "external_directory",
              resources: ["/etc/group"],
            }),
          )
          yield* Effect.promise(() =>
            awaitFrame(frames, (frame) => permissionAskFrames([frame], barrierPermission.id).length > 0),
          )
          expect(permissionAskFrames(frames, livePermissionProbe.id).length).toBeGreaterThanOrEqual(1)
          expect(questionEventFrames(frames, "question.asked", unsupportedForm.id)).toHaveLength(0)
          yield* Effect.promise(() => Bun.sleep(300))
          expect(questionEventFrames(frames, "question.asked", strippedForm.id)).toHaveLength(0)
          expect(questionEventFrames(frames, "question.asked", unsupportedForm.id)).toHaveLength(0)
          // Resolve/cancel the owned pending state: the supported asks through
          // the relay, the stripped-domain leftovers through the raw API.
          sendRelay({
            type: "command",
            id: "permission-only-answer-1",
            command: "permission_respond",
            sessionId: siblingSession.id,
            data: { requestID: livePermissionProbe.id, reply: "once" },
          })
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "permission-only-answer-1"))),
          ).toEqual({ type: "response", id: "permission-only-answer-1", result: {} })
          yield* Effect.promise(() =>
            client.permission.reply({ sessionID: siblingSession.id, requestID: barrierPermission.id, reply: "once" }),
          )
          yield* Effect.promise(() => client.form.cancel({ sessionID: siblingSession.id, formID: unsupportedForm.id }))

          sendRelay({ type: "unsubscribe", sessionId: siblingSession.id })
          strip.domain = "permission"
          const formOnlyForm = yield* Effect.promise(() =>
            client.form.create({
              sessionID: siblingSession.id,
              title: "Form-only probe",
              metadata: { kind: "question" },
              fields: [
                {
                  key: "choice",
                  title: "Form only",
                  description: "Answer the form-only probe?",
                  type: "string",
                  required: true,
                  custom: false,
                  options: [{ value: "yes", label: "yes" }],
                },
              ],
            }),
          )
          const strippedPermission = yield* Effect.promise(() =>
            client.permission.create({
              sessionID: siblingSession.id,
              action: "external_directory",
              resources: ["/etc"],
              metadata: { skillShell: true },
            }),
          )
          expect(strippedPermission.effect).toBe("ask")
          sendRelay({ type: "subscribe", sessionId: siblingSession.id })
          yield* Effect.promise(() =>
            awaitFrame(frames, (frame) => questionEventFrames([frame], "question.asked", formOnlyForm.id).length > 0),
          )
          yield* Effect.promise(() => Bun.sleep(300))
          expect(permissionAskFrames(frames, strippedPermission.id)).toHaveLength(0)
          // New live asks while subscribed: a supported question form forwards,
          // an unsupported permission drops — the barrier frame for the later
          // supported form proves the unsupported permission.asked was already
          // processed when the zero-count is read.
          const liveFormProbe = yield* Effect.promise(() =>
            client.form.create({
              sessionID: siblingSession.id,
              title: "Live form probe",
              metadata: { kind: "question" },
              fields: [
                {
                  key: "choice",
                  title: "Live",
                  description: "Live form while the permission domain is stripped",
                  type: "string",
                  required: true,
                  custom: false,
                  options: [{ value: "yes", label: "yes" }],
                },
              ],
            }),
          )
          const unsupportedPermission = yield* Effect.promise(() =>
            client.permission.create({
              sessionID: siblingSession.id,
              action: "external_directory",
              resources: ["/etc/shadow"],
              metadata: { skillShell: true },
            }),
          )
          const barrierForm = yield* Effect.promise(() =>
            client.form.create({
              sessionID: siblingSession.id,
              title: "Barrier form",
              metadata: { kind: "question" },
              fields: [
                {
                  key: "choice",
                  title: "Barrier",
                  description: "Barrier form proving event processing",
                  type: "string",
                  required: true,
                  custom: false,
                  options: [{ value: "yes", label: "yes" }],
                },
              ],
            }),
          )
          yield* Effect.promise(() =>
            awaitFrame(frames, (frame) => questionEventFrames([frame], "question.asked", barrierForm.id).length > 0),
          )
          expect(questionEventFrames(frames, "question.asked", liveFormProbe.id).length).toBeGreaterThanOrEqual(1)
          expect(permissionAskFrames(frames, unsupportedPermission.id)).toHaveLength(0)
          yield* Effect.promise(() => Bun.sleep(300))
          expect(permissionAskFrames(frames, strippedPermission.id)).toHaveLength(0)
          expect(permissionAskFrames(frames, unsupportedPermission.id)).toHaveLength(0)
          // Resolve/cancel the owned pending state.
          sendRelay({
            type: "command",
            id: "form-only-reply-1",
            command: "question_reply",
            sessionId: siblingSession.id,
            data: { requestID: formOnlyForm.id, answers: [["yes"]] },
          })
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "form-only-reply-1"))),
          ).toEqual({ type: "response", id: "form-only-reply-1", result: {} })
          expect(
            (yield* Effect.promise(() => client.form.state({ sessionID: siblingSession.id, formID: formOnlyForm.id })))
              .status,
          ).toBe("answered")
          yield* Effect.promise(() =>
            client.permission.reply({
              sessionID: siblingSession.id,
              requestID: unsupportedPermission.id,
              reply: "reject",
            }),
          )
          strip.domain = "none"
          sendRelay({ type: "unsubscribe", sessionId: siblingSession.id })

          // Ancestry distance bound: eight parent edges forward, replay, and
          // answer through the root-ID fallback; the ninth edge is rejected.
          sendRelay({ type: "unsubscribe", sessionId: siblingSession.id })
          let chainAncestor = siblingSession.id
          const chain: string[] = []
          for (let depth = 0; depth < 9; depth++) {
            const exported = yield* Effect.promise(() => client.session.export({ sessionID: chainAncestor }))
            const imported = yield* Effect.promise(() =>
              client.session.import({
                ...exported,
                info: { ...exported.info, id: Session.ID.create(), parentID: chainAncestor },
                location,
              }),
            )
            chain.push(imported.id)
            chainAncestor = imported.id
          }
          const edge8 = chain[7]
          const edge9 = chain[8]
          const edge8Request = yield* Effect.promise(() =>
            client.permission.create({ sessionID: edge8, action: "external_directory", resources: ["/etc"] }),
          )
          const edge9Request = yield* Effect.promise(() =>
            client.permission.create({ sessionID: edge9, action: "external_directory", resources: ["/etc"] }),
          )
          const edge8Form = yield* Effect.promise(() =>
            client.form.create({
              sessionID: edge8,
              title: "Edge8 form",
              metadata: { kind: "question" },
              fields: [
                {
                  key: "choice",
                  title: "Edge8",
                  description: "Answer the distance-eight form?",
                  type: "string",
                  required: true,
                  custom: false,
                  options: [{ value: "yes", label: "yes" }],
                },
              ],
            }),
          )
          const edge9Form = yield* Effect.promise(() =>
            client.form.create({
              sessionID: edge9,
              title: "Edge9 form",
              metadata: { kind: "question" },
              fields: [
                {
                  key: "choice",
                  title: "Edge9",
                  description: "Answer the distance-nine form?",
                  type: "string",
                  required: true,
                  custom: false,
                  options: [{ value: "yes", label: "yes" }],
                },
              ],
            }),
          )
          expect(edge8Request.effect).toBe("ask")
          expect(edge9Request.effect).toBe("ask")
          sendRelay({ type: "subscribe", sessionId: siblingSession.id })
          yield* Effect.promise(() =>
            awaitFrame(frames, (frame) => permissionAskFrames([frame], edge8Request.id).length > 0),
          )
          expect(
            isRecord(permissionAskFrames(frames, edge8Request.id)[0]) &&
              (permissionAskFrames(frames, edge8Request.id)[0] as Record<string, unknown>).parentSessionId ===
                siblingSession.id,
          ).toBe(true)
          yield* Effect.promise(() => Bun.sleep(400))
          expect(permissionAskFrames(frames, edge9Request.id)).toHaveLength(0)
          expect(questionEventFrames(frames, "question.asked", edge8Form.id).length).toBeGreaterThanOrEqual(1)
          expect(questionEventFrames(frames, "question.asked", edge9Form.id)).toHaveLength(0)
          // The distance-eight root-ID fallback answers both domains; the
          // distance-nine pending is refused with its pending unchanged.
          sendRelay({
            type: "command",
            id: "edge8-answer-1",
            command: "permission_respond",
            sessionId: siblingSession.id,
            data: { requestID: edge8Request.id, reply: "once" },
          })
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "edge8-answer-1")))).toEqual(
            { type: "response", id: "edge8-answer-1", result: {} },
          )
          expect(
            (yield* Effect.promise(() => client.permission.list({ sessionID: edge8 }))).some(
              (request) => request.id === edge8Request.id,
            ),
          ).toBe(false)
          sendRelay({
            type: "command",
            id: "edge8-form-reply-1",
            command: "question_reply",
            sessionId: siblingSession.id,
            data: { requestID: edge8Form.id, answers: [["yes"]] },
          })
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "edge8-form-reply-1"))),
          ).toEqual({ type: "response", id: "edge8-form-reply-1", result: {} })
          expect(
            (yield* Effect.promise(() => client.form.state({ sessionID: edge8, formID: edge8Form.id }))).status,
          ).toBe("answered")
          sendRelay({
            type: "command",
            id: "edge9-refused-1",
            command: "permission_respond",
            sessionId: siblingSession.id,
            data: { requestID: edge9Request.id, reply: "once" },
          })
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "edge9-refused-1"))),
          ).toEqual({ type: "response", id: "edge9-refused-1", error: "permission request not found" })
          expect(
            (yield* Effect.promise(() => client.permission.list({ sessionID: edge9 }))).some(
              (request) => request.id === edge9Request.id,
            ),
          ).toBe(true)
          sendRelay({
            type: "command",
            id: "edge9-form-refused-1",
            command: "question_reply",
            sessionId: siblingSession.id,
            data: { requestID: edge9Form.id, answers: [["yes"]] },
          })
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "edge9-form-refused-1"))),
          ).toEqual({ type: "response", id: "edge9-form-refused-1", error: "question request not found" })
          expect(
            (yield* Effect.promise(() => client.form.state({ sessionID: edge9, formID: edge9Form.id }))).status,
          ).toBe("pending")
          sendRelay({ type: "unsubscribe", sessionId: siblingSession.id })

          // A disconnect during the initial replay invalidates the in-flight
          // snapshot: the reconnect replay alone emits the pending asks.
          sendRelay({ type: "unsubscribe", sessionId: siblingSession.id })
          const reconnectProbe = yield* Effect.promise(() =>
            client.permission.create({
              sessionID: siblingSession.id,
              action: "external_directory",
              resources: ["/etc/passwd"],
            }),
          )
          expect(reconnectProbe.effect).toBe("ask")
          delayPermissionList = true
          sendRelay({ type: "subscribe", sessionId: siblingSession.id })
          yield* Effect.promise(() => Bun.sleep(200))
          const beforeMidReplaySocket = byConnection.get(firstConnectionId)
          beforeMidReplaySocket?.close()
          expect(
            yield* Effect.promise(() =>
              waitFor(async () =>
                Promise.resolve(
                  byConnection.get(firstConnectionId) !== undefined &&
                    byConnection.get(firstConnectionId) !== beforeMidReplaySocket,
                ),
              ),
            ),
          ).toBe(true)
          delayPermissionList = false
          delayGate.resolve()
          yield* Effect.promise(() => Bun.sleep(400))
          expect(permissionAskFrames(frames, reconnectProbe.id).length).toBe(1)
          sendRelay({ type: "unsubscribe", sessionId: siblingSession.id })

          // An immediate unsubscribe supersedes the in-flight subscribe replay.
          sendRelay({ type: "subscribe", sessionId: other.id })
          sendRelay({ type: "unsubscribe", sessionId: other.id })
          yield* Effect.promise(() => Bun.sleep(300))
          expect(permissionAskFrames(frames, mismatch.id)).toHaveLength(0)
          sendRelay({ type: "subscribe", sessionId: other.id })
          const otherReplayFrame = yield* Effect.promise(() =>
            awaitFrame(frames, (frame) => permissionAskFrames([frame], mismatch.id).length > 0),
          )
          expect(isRecord(otherReplayFrame) && otherReplayFrame.parentSessionId).toBeUndefined()
        }),
      ),
    )
  } finally {
    await relay.stop(true)
    await model.stop(true)
  }
}, 30_000)

test("translates question asks with real host replies, cardinality refusal, and reject", async () => {
  await using input = await fixture()
  const model = relayModelServer()
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
  const layout = interactiveLayout(path.join(input.directory, "remote-session-questions"), input.home)
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
          const session = yield* Effect.promise(() =>
            client.session.create({ title: "Relay questions", location, model: { providerID: "fixture", id: "chat" } }),
          )
          yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
          yield* Effect.promise(() => opened.promise)
          socket?.send(JSON.stringify({ type: "subscribe", sessionId: session.id }))

          socket?.send(
            JSON.stringify({
              type: "command",
              id: "ask-1",
              command: "send_message",
              data: { sessionID: session.id, parts: [{ type: "text", text: "relay question probe" }] },
            }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "ask-1")))).toEqual({
            type: "response",
            id: "ask-1",
            result: {},
          })
          const askedFrame = yield* Effect.promise(() =>
            awaitFrame(
              frames,
              (frame) => isRecord(frame) && frame.type === "event" && frame.event === "question.asked",
            ),
          )
          const askedData = isRecord(askedFrame) ? askedFrame.data : undefined
          expect(isRecord(askedData) && typeof askedData.id === "string" && askedData.id.startsWith("frm_")).toBe(true)
          expect(isRecord(askedFrame) && askedFrame.sessionId).toBe(session.id)
          const formID = isRecord(askedData) && typeof askedData.id === "string" ? askedData.id : ""
          const questions = Schema.decodeUnknownSync(Schema.Array(QuestionV1.Info))(
            (isRecord(askedData) ? askedData.questions : undefined) as never,
          )
          expect(questions).toEqual([
            {
              question: "Which environment should we deploy to?",
              header: "Deploy",
              options: [
                { label: "staging", description: "Staging cluster" },
                { label: "prod", description: "Production cluster" },
              ],
              custom: true,
            },
            {
              question: "Which clusters need the change?",
              header: "Clusters",
              options: [
                { label: "us-east", description: "US east cluster" },
                { label: "eu-west", description: "EU west cluster" },
              ],
              multiple: true,
              custom: true,
            },
          ])
          expect(isRecord(askedData) && isRecord(askedData.tool) && typeof askedData.tool.callID === "string").toBe(
            true,
          )

          // A single-select v2 field cannot accept several labels: refuse
          // instead of truncating, and leave the question pending.
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "cardinality-1",
              command: "question_reply",
              sessionId: session.id,
              data: { requestID: formID, answers: [["staging", "prod"], []] },
            }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "cardinality-1")))).toEqual({
            type: "response",
            id: "cardinality-1",
            error: "question_reply cannot map multiple selections onto a single-select question",
          })
          expect((yield* Effect.promise(() => client.form.state({ sessionID: session.id, formID }))).status).toBe(
            "pending",
          )

          // The real host form is answered by the relay reply; the question
          // tool resolves and the model continues. The multiselect field maps
          // positionally onto a string-array answer.
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "reply-1",
              command: "question_reply",
              sessionId: session.id,
              data: { requestID: formID, answers: [["staging"], ["us-east", "eu-west"]] },
            }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "reply-1")))).toEqual({
            type: "response",
            id: "reply-1",
            result: {},
          })
          const repliedFrame = yield* Effect.promise(() =>
            awaitFrame(
              frames,
              (frame) => isRecord(frame) && frame.type === "event" && frame.event === "question.replied",
            ),
          )
          expect(isRecord(repliedFrame) && repliedFrame.data).toMatchObject({
            sessionID: session.id,
            requestID: formID,
            answers: [["staging"], ["us-east", "eu-west"]],
          })
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )
          expect((yield* Effect.promise(() => client.form.state({ sessionID: session.id, formID }))).status).toBe(
            "answered",
          )
          const messages = (yield* Effect.promise(() => client.message.list({ sessionID: session.id, order: "asc" })))
            .data
          const questionPart = messages
            .filter((message) => message.type === "assistant")
            .flatMap((message) => message.content)
            .find((part) => part.type === "tool" && part.name === "question")
          expect(
            questionPart?.type === "tool" && questionPart.state.status === "completed"
              ? questionPart.state.metadata?.answers
              : undefined,
          ).toEqual([["staging"], ["us-east", "eu-west"]])
          expect(
            messages.some(
              (message) =>
                message.type === "assistant" &&
                message.content.some((part) => part.type === "text" && part.text === "Fixture complete"),
            ),
          ).toBe(true)

          // Rejection cancels the durable form; the question tool surfaces the
          // dismissal and the session goes idle.
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "ask-2",
              command: "send_message",
              data: { sessionID: session.id, parts: [{ type: "text", text: "relay question reject probe" }] },
            }),
          )
          yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "ask-2")))
          const rejectedFrame = yield* Effect.promise(() =>
            awaitFrame(
              frames,
              (frame) =>
                isRecord(frame) &&
                frame.type === "event" &&
                frame.event === "question.asked" &&
                isRecord(frame.data) &&
                frame.data.id !== formID,
            ),
          )
          const rejectedData = isRecord(rejectedFrame) ? rejectedFrame.data : undefined
          const rejectedFormID = isRecord(rejectedData) && typeof rejectedData.id === "string" ? rejectedData.id : ""
          expect(rejectedFormID.startsWith("frm_")).toBe(true)
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "reject-1",
              command: "question_reject",
              sessionId: session.id,
              data: { requestID: rejectedFormID },
            }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "reject-1")))).toEqual({
            type: "response",
            id: "reject-1",
            result: {},
          })
          yield* Effect.promise(() =>
            awaitFrame(
              frames,
              (frame) => isRecord(frame) && frame.type === "event" && frame.event === "question.rejected",
            ),
          )
          yield* Effect.promise(() =>
            client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) }),
          )
          expect(
            (yield* Effect.promise(() => client.form.state({ sessionID: session.id, formID: rejectedFormID }))).status,
          ).toBe("cancelled")
          expect(Boolean((yield* Effect.promise(() => client.session.active()))[session.id])).toBe(false)

          // Unknown request ids are refused explicitly.
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "unknown-reply-1",
              command: "question_reply",
              sessionId: session.id,
              data: { requestID: "frm_never_created", answers: [[]] },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "unknown-reply-1"))),
          ).toEqual({ type: "response", id: "unknown-reply-1", error: "question request not found" })

          // Nonquestion control forms are never translated as questions: no
          // question.asked frame, replies and rejects refused without
          // cancelling or answering, and no terminal frames when the raw form
          // API settles them.
          const control = yield* Effect.promise(() =>
            client.form.create({
              sessionID: session.id,
              title: "Web Search",
              metadata: { kind: "websearch.provider" },
              fields: [
                {
                  key: "choice",
                  title: "Control",
                  description: "Allow OpenCode to search the web for up-to-date information?",
                  type: "string",
                  required: true,
                  custom: false,
                  options: [
                    { value: "allow", label: "Allow search" },
                    { value: "disable", label: "Disable web search" },
                  ],
                },
              ],
            }),
          )
          yield* Effect.promise(() => Bun.sleep(300))
          expect(questionEventFrames(frames, "question.asked", control.id)).toHaveLength(0)
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "control-reply-1",
              command: "question_reply",
              sessionId: session.id,
              data: { requestID: control.id, answers: [["allow"]] },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "control-reply-1"))),
          ).toEqual({ type: "response", id: "control-reply-1", error: "unsupported question form" })
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "control-reject-1",
              command: "question_reject",
              sessionId: session.id,
              data: { requestID: control.id },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "control-reject-1"))),
          ).toEqual({ type: "response", id: "control-reject-1", error: "unsupported question form" })
          expect(
            (yield* Effect.promise(() => client.form.state({ sessionID: session.id, formID: control.id }))).status,
          ).toBe("pending")
          yield* Effect.promise(() =>
            client.form.reply({ sessionID: session.id, formID: control.id, answer: { choice: "allow" } }),
          )
          yield* Effect.promise(() => Bun.sleep(300))
          expect(questionEventFrames(frames, "question.replied", control.id)).toHaveLength(0)
          expect(questionEventFrames(frames, "question.rejected", control.id)).toHaveLength(0)
          expect(
            (yield* Effect.promise(() => client.form.state({ sessionID: session.id, formID: control.id }))).status,
          ).toBe("answered")

          // A question-kind form with unsupported fields (a `when` condition)
          // is refused on ask, reply, and reject alike.
          const conditional = yield* Effect.promise(() =>
            client.form.create({
              sessionID: session.id,
              title: "Conditional",
              metadata: { kind: "question" },
              fields: [
                {
                  key: "choice",
                  title: "Choice",
                  description: "Allow?",
                  type: "string",
                  required: true,
                  custom: false,
                  options: [{ value: "allow", label: "Allow" }],
                },
                {
                  key: "first",
                  title: "First",
                  description: "Answer the first field?",
                  type: "string",
                  required: true,
                  custom: false,
                  options: [{ value: "yes", label: "yes" }],
                  when: [{ key: "choice", op: "eq", value: "allow" }],
                },
              ],
            }),
          )
          yield* Effect.promise(() => Bun.sleep(300))
          expect(questionEventFrames(frames, "question.asked", conditional.id)).toHaveLength(0)
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "conditional-reply-1",
              command: "question_reply",
              sessionId: session.id,
              data: { requestID: conditional.id, answers: [["allow"], ["yes"]] },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "conditional-reply-1"))),
          ).toEqual({ type: "response", id: "conditional-reply-1", error: "unsupported question form" })
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "conditional-reject-1",
              command: "question_reject",
              sessionId: session.id,
              data: { requestID: conditional.id },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "conditional-reject-1"))),
          ).toEqual({ type: "response", id: "conditional-reject-1", error: "unsupported question form" })
          expect(
            (yield* Effect.promise(() => client.form.state({ sessionID: session.id, formID: conditional.id }))).status,
          ).toBe("pending")
        }),
      ),
    )
  } finally {
    await relay.stop(true)
    await model.stop(true)
  }
}, 30_000)

test("answers list_models with an explicit error when the host client has no catalog", async () => {
  await using input = await fixture()
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
  const layout = interactiveLayout(path.join(input.directory, "remote-session-uncataloged"), input.home)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch(layout, {
            models: false,
            recover: false,
            plugins: [
              createRemoteSessionPlugin({
                relayURL: `http://127.0.0.1:${relay.port}`,
                bearerToken: "fixture-bearer",
                client: () => stubClient(),
                allowHttpLoopback: true,
              }),
            ],
          })
          yield* Effect.promise(() =>
            createClient({
              baseUrl: server.url,
              headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
            }).plugin.awaitActivation({ location: { directory: input.cwd } }),
          )
          yield* Effect.promise(() => opened.promise)
          yield* Effect.promise(() => waitFor(() => Promise.resolve(frames.length >= 1)))
          socket?.send(
            JSON.stringify({
              type: "command",
              id: "models-stub-1",
              command: "list_models",
              data: { protocolVersion: 1 },
            }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "models-stub-1")))).toEqual({
            type: "response",
            id: "models-stub-1",
            error: "model catalog is unavailable",
          })
        }),
      ),
    )
  } finally {
    await relay.stop(true)
  }
}, 30_000)

// Stub for a host that never supplied a model catalog; only heartbeat reads
// touch this client.
function stubClient() {
  return {
    session: {
      list: async () => ({ data: [] }),
      active: async () => ({}),
    },
  } as unknown as RemoteSessionClient
}

function response(value: unknown, id: string) {
  return isRecord(value) && value.type === "response" && value.id === id
}

async function awaitFrame(values: unknown[], matches: (value: unknown) => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = values.find((item) => matches(item))
    if (value !== undefined) return value
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for relay frame: ${JSON.stringify(values)}`)
}

async function waitFor(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await check()) return true
    await Bun.sleep(10)
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

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
