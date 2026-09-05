import { expect, test } from "bun:test"
import { createClient } from "@kilocode/client"
import { Effect } from "effect"
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
            result: { protocolVersion: 1, commands: expect.any(Array) },
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
            JSON.stringify({ type: "command", id: "interrupt-foreign-1", command: "interrupt", sessionId: foreign.id, data: {} }),
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
            isRecord(selectedFrame) && isRecord(selectedFrame.result)
              ? selectedFrame.result.currentModel
              : undefined,
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
          const aliasCreate = yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "create-alias-1")))
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
          expect(
            (yield* Effect.promise(() => client.session.get({ sessionID: aliasSessionID }))).model,
          ).toEqual({ id: advertisedModelID, providerID: advertisedProviderID, variant: "default" })
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
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "alias-prompt-1"))),
          ).toEqual({ type: "response", id: "alias-prompt-1", result: {} })
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
            yield* Effect.promise(() =>
              waitFor(async () => Boolean((await client.session.active())[session.id])),
            ),
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
                  { type: "file", mime: "text/plain", filename: "notes.txt", url: `data:text/plain;base64,${btoa(payload)}` },
                ],
              },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "cancel-admit-1"))),
          ).toEqual({ type: "response", id: "cancel-admit-1", result: {} })

          socket?.send(
            JSON.stringify({
              type: "command",
              id: "cancel-drop-1",
              command: "drop_queued_message",
              sessionId: session.id,
              data: { messageID: "msg_cancel_1" },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "cancel-drop-1"))),
          ).toEqual({ type: "response", id: "cancel-drop-1", result: {} })

          socket?.send(
            JSON.stringify({
              type: "command",
              id: "cancel-drop-2",
              command: "drop_queued_message",
              sessionId: session.id,
              data: { messageID: "msg_cancel_1" },
            }),
          )
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "cancel-drop-2"))),
          ).toEqual({ type: "response", id: "cancel-drop-2", error: "message not queued" })

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
            JSON.stringify({ type: "command", id: "models-stub-1", command: "list_models", data: { protocolVersion: 1 } }),
          )
          expect(
            yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "models-stub-1"))),
          ).toEqual({ type: "response", id: "models-stub-1", error: "model catalog is unavailable" })
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
