import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { CorsConfig, type CorsOptions } from "@opencode-ai/server/cors"
import { Context, Effect, Layer, Option, Queue } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Socket from "effect/unstable/socket/Socket"
import Http from "node:http"
import { mkdir } from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import { registerAdapter } from "../../../src/control-plane/adapters"
import type { WorkspaceAdapter } from "../../../src/control-plane/types"
import { Workspace } from "../../../src/control-plane/workspace"
import { Project } from "../../../src/project/project"
import { Session } from "../../../src/session/session"
import { ServerAuth } from "../../../src/server/auth"
import { PtyConnectApi } from "../../../src/server/routes/instance/httpapi/groups/pty"
import { ptyConnectAuthorizationLayer } from "../../../src/server/routes/instance/httpapi/middleware/authorization"
import { instanceContextLayer } from "../../../src/server/routes/instance/httpapi/middleware/instance-context"
import { workspaceRoutingLayer } from "../../../src/server/routes/instance/httpapi/middleware/workspace-routing"
import { resetDatabase } from "../../fixture/db"
import { tmpdirScoped } from "../../fixture/fixture"
import { workspaceLayerWithRuntimeFlags } from "../../fixture/workspace"
import { testEffect } from "../../lib/effect"

// The legacy PTY connect group routes remote workspaces before its handler runs, and the
// websocket proxy does not forward Origin. These tests serve the real group middleware stack
// against a fake remote workspace and check what reaches the remote upgrade.

const state = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() => Effect.promise(() => resetDatabase()))
  }),
)

const it = testEffect(
  Layer.mergeAll(
    state,
    NodeHttpServer.layerTest,
    NodeServices.layer,
    workspaceLayerWithRuntimeFlags({ experimentalWorkspaces: true }),
    Socket.layerWebSocketConstructorGlobal,
  ),
)

const untrusted = "https://untrusted.example"
const password = "pty-remote-secret"

const listen = (
  handler: (request: HttpServerRequest.HttpServerRequest) => Effect.Effect<HttpServerResponse.HttpServerResponse>,
) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(NodeHttpServer.layer(Http.createServer, { host: "127.0.0.1", port: 0 }))
    const server = Context.get(context, HttpServer.HttpServer)
    yield* server.serve(HttpServerRequest.HttpServerRequest.use(handler))
    return HttpServer.formatAddress(server.address)
  })

// Fake remote workspace: answers the sync bootstrap so the workspace counts as syncing, and
// records every PTY upgrade the local proxy forwards to it.
const remote = Effect.gen(function* () {
  const hits = yield* Queue.unbounded<string>()
  const url = yield* listen((request) => {
    const pathname = new URL(request.url, "http://localhost").pathname
    if (pathname === "/base/global/event")
      return Effect.succeed(
        HttpServerResponse.text('data: {"payload":{"type":"server.connected","properties":{}}}\n\n', {
          contentType: "text/event-stream",
        }),
      )
    if (pathname === "/base/sync/history") return HttpServerResponse.json([]).pipe(Effect.orDie)
    if (!pathname.startsWith("/base/pty/")) return Effect.succeed(HttpServerResponse.empty({ status: 404 }))
    return Effect.gen(function* () {
      Queue.offerUnsafe(hits, pathname)
      const socket = yield* Effect.orDie(request.upgrade)
      yield* socket.runRaw(() => Effect.void).pipe(Effect.catch(() => Effect.void))
      return HttpServerResponse.empty()
    })
  })
  return { url, hits }
})

const adapter = (directory: string, url: string): WorkspaceAdapter => ({
  name: "Remote PTY Test",
  description: "Remote PTY test workspace",
  configure: (info) => ({ ...info, name: "remote-pty", directory }),
  create: async () => {
    await mkdir(directory, { recursive: true })
  },
  async remove() {},
  target: () => ({ type: "remote" as const, url }),
})

const workspace = (url: string) =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ git: true })
    const project = yield* Project.use.fromDirectory(dir)
    const type = "remote-pty-origin"
    registerAdapter(project.project.id, type, adapter(path.join(dir, `.${type}`), url))
    return yield* Effect.acquireRelease(
      Workspace.Service.use((svc) => svc.create({ type, branch: null, extra: null, projectID: project.project.id })),
      (info) => Workspace.use.remove(info.id).pipe(Effect.ignore),
    )
  })

// Real PtyConnectApi group (and so its real middleware order). The local handler must never
// run for a remote workspace, so it fails loudly if reached.
const serve = (auth: string | undefined, cors?: CorsOptions) =>
  HttpApiBuilder.layer(PtyConnectApi).pipe(
    Layer.provide(
      HttpApiBuilder.group(PtyConnectApi, "pty-connect", (handlers) =>
        handlers.handleRaw("connect", () => Effect.succeed(HttpServerResponse.empty({ status: 500 }))),
      ),
    ),
    Layer.provide(
      ptyConnectAuthorizationLayer.pipe(
        Layer.provide(
          ServerAuth.Config.configLayer({ username: "kilo", password: auth ? Option.some(auth) : Option.none() }),
        ),
        Layer.provide(Layer.succeed(CorsConfig)(cors)),
      ),
    ),
    Layer.provide(
      workspaceRoutingLayer.pipe(Layer.provide([Socket.layerWebSocketConstructorGlobal, FetchHttpClient.layer])),
    ),
    Layer.provide(instanceContextLayer),
    Layer.provide(Layer.mock(Session.Service)({})),
    HttpRouter.serve,
    Layer.build,
  )

const address = HttpServer.HttpServer.use((server) => Effect.succeed(HttpServer.formatAddress(server.address)))

// Raw upgrade so the test controls Origin and reads the exact status line.
const handshake = (url: string, headers: Record<string, string> = {}) =>
  Effect.promise(() => {
    const target = new URL(url)
    const result = Promise.withResolvers<number>()
    const lines = [
      `GET ${target.pathname}${target.search} HTTP/1.1`,
      `Host: ${target.host}`,
      "Connection: Upgrade",
      "Upgrade: websocket",
      "Sec-WebSocket-Version: 13",
      `Sec-WebSocket-Key: ${Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64")}`,
      ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
      "",
      "",
    ]
    const socket = net.connect(Number(target.port), target.hostname, () => socket.write(lines.join("\r\n")))
    let data = ""
    socket.setEncoding("utf8")
    socket.on("data", (chunk: string) => {
      data += chunk
      if (!data.includes("\r\n")) return
      socket.destroy()
      result.resolve(Number(data.split("\r\n")[0]?.split(" ")[1]))
    })
    socket.on("error", result.reject)
    socket.on("close", () => result.reject(new Error(`closed before status line: ${data}`)))
    return result.promise
  })

const setup = (auth?: string, cors?: CorsOptions) =>
  Effect.gen(function* () {
    const target = yield* remote
    const info = yield* workspace(`${target.url}/base`)
    yield* serve(auth, cors)
    const base = yield* address
    const connect = (query = "") => `${base}/pty/pty_remote/connect?workspace=${info.id}&cursor=0${query}`
    // A proxied upgrade reaches the remote; a rejected one never does.
    const proxied = Queue.take(target.hits).pipe(Effect.timeout("5 seconds"))
    const untouched = Effect.gen(function* () {
      expect(yield* Queue.size(target.hits)).toBe(0)
    })
    return { connect, proxied, untouched }
  })

describe("legacy PTY connect Origin policy for remote workspaces", () => {
  it.live("rejects disallowed Origins before proxying when password auth is off", () =>
    Effect.gen(function* () {
      const api = yield* setup(undefined, { cors: ["https://custom.example"] })

      expect(yield* handshake(api.connect(), { origin: untrusted })).toBe(403)
      expect(yield* handshake(api.connect(), { origin: "null" })).toBe(403)
      expect(yield* handshake(api.connect("&ticket="), { origin: untrusted })).toBe(403)
      expect(yield* handshake(api.connect("&ticket=forged"), { origin: untrusted })).toBe(403)
      yield* api.untouched

      // Native clients send no Origin; built-in and configured CORS origins stay allowed.
      expect(yield* handshake(api.connect())).toBe(101)
      expect(yield* api.proxied).toBe("/base/pty/pty_remote/connect")
      expect(yield* handshake(api.connect(), { origin: "http://localhost:3000" })).toBe(101)
      yield* api.proxied
      expect(yield* handshake(api.connect(), { origin: "https://custom.example" })).toBe(101)
      yield* api.proxied
    }),
  )

  it.live("keeps password auth and ticket Origin checks ahead of the proxy", () =>
    Effect.gen(function* () {
      const api = yield* setup(password)
      const token = encodeURIComponent(Buffer.from(`kilo:${password}`).toString("base64"))

      expect(yield* handshake(api.connect(), { origin: untrusted })).toBe(401)
      expect(yield* handshake(api.connect("&ticket=forged"), { origin: untrusted })).toBe(403)
      yield* api.untouched

      // VS Code webviews connect cross-origin with auth_token; credentials, not Origin, gate them.
      expect(yield* handshake(api.connect(`&auth_token=${token}`), { origin: "vscode-webview://kilo-test" })).toBe(101)
      yield* api.proxied
    }),
  )
})
