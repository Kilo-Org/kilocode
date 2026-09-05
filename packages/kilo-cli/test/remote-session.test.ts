import { expect, test } from "bun:test"
import { createClient } from "@kilocode/client"
import { Effect } from "effect"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { createRemoteSessionPlugin } from "../src/remote-session"
import type { Layout } from "../src/paths"
import { fixture } from "./fixture"

test("translates supported v1 relay frames through a local WebSocket and isolated v2 host", async () => {
  await using input = await fixture()
  const opened = Promise.withResolvers<void>()
  const frames: unknown[] = []
  let socket: { send(data: string): void } | undefined
  const relay = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url)
      if (url.pathname !== "/api/user/cli") return new Response(null, { status: 404 })
      expect(url.searchParams.get("token")).toBe("fixture-bearer")
      expect(url.searchParams.get("connectionId")).toMatch(/^[0-9a-f-]{36}$/)
      if (server.upgrade(request)) return
      return new Response(null, { status: 400 })
    },
    websocket: {
      open(ws) {
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
            JSON.stringify({ type: "command", id: "unsupported-1", command: "drop_queued_message", data: {} }),
          )
          expect(yield* Effect.promise(() => awaitFrame(frames, (frame) => response(frame, "unsupported-1")))).toEqual({
            type: "response",
            id: "unsupported-1",
            error: "unsupported command: drop_queued_message",
          })
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
