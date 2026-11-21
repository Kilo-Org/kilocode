import { afterEach, describe, expect, test } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Location } from "@opencode-ai/core/location"
import { Pty } from "@opencode-ai/core/pty"
import { PtyTicket } from "@opencode-ai/core/pty/ticket"
import { ConfigProvider, Config as EffectConfig, Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import net from "node:net"
import { ServerAuth } from "../../../src/server/auth"
import { HttpApiApp } from "../../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

// PTY route tests do not need an indexing worker per temp project.
process.env.KILO_DISABLE_CODEBASE_INDEXING = "vscode-no-workspace"

const testPty = process.platform === "win32" ? test.skip : test
const untrusted = "https://untrusted.example"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

// Serves the real HttpApi routes on a loopback port with the given server password.
function serve(password: string | undefined, body: (url: string) => Promise<void>): Promise<void> {
  const routes: Layer.Layer<never, EffectConfig.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
    HttpApiApp.routes,
    { disableListenLog: true, disableLogger: true },
  )
  const layer = routes.pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          KILO_SERVER_PASSWORD: password,
          KILO_EXPERIMENTAL_DISABLE_FILEWATCHER: process.env.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER ?? "true",
        }),
      ),
    ),
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(NodeServices.layer),
  )
  return HttpServer.HttpServer.use((server) => Effect.succeed(HttpServer.formatAddress(server.address))).pipe(
    Effect.flatMap((url) => Effect.promise(() => body(url))),
    Effect.scoped,
    Effect.provide(layer),
    Effect.runPromise,
  )
}

// Sends a raw WebSocket upgrade so the test controls Origin and Host and observes the exact status.
function handshake(url: string, headers: Record<string, string> = {}) {
  const target = new URL(url)
  const result = Promise.withResolvers<number>()
  const lines = [
    `GET ${target.pathname}${target.search} HTTP/1.1`,
    `Host: ${headers.host ?? target.host}`,
    "Connection: Upgrade",
    "Upgrade: websocket",
    "Sec-WebSocket-Version: 13",
    `Sec-WebSocket-Key: ${Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64")}`,
    ...Object.entries(headers)
      .filter(([key]) => key !== "host")
      .map(([key, value]) => `${key}: ${value}`),
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
}

type Route = {
  name: string
  base: string
  scope: (dir: string) => string
  info: (body: unknown) => string
  ticket: (body: unknown) => string
}

const routes: Route[] = [
  {
    name: "legacy /pty/:id/connect",
    base: "/pty",
    scope: (dir) => `directory=${encodeURIComponent(dir)}`,
    info: (body) => Schema.decodeUnknownSync(Pty.Info)(body).id,
    ticket: (body) => Schema.decodeUnknownSync(PtyTicket.ConnectToken)(body).ticket,
  },
  {
    name: "v2 /api/pty/:id/connect",
    base: "/api/pty",
    scope: (dir) => `${encodeURIComponent("location[directory]")}=${encodeURIComponent(dir)}`,
    info: (body) => Schema.decodeUnknownSync(Location.response(Pty.Info))(body).data.id,
    ticket: (body) => Schema.decodeUnknownSync(Location.response(PtyTicket.ConnectToken))(body).data.ticket,
  },
]

function client(url: string, route: Route, dir: string, auth: Record<string, string> = {}) {
  const call = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set("x-kilo-directory", dir)
    for (const [key, value] of Object.entries(auth)) headers.set(key, value)
    return fetch(`${url}${route.base}${path}`, { ...init, headers })
  }
  return {
    async create() {
      const res = await call("", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "/usr/bin/env", args: ["sh", "-c", "sleep 30"] }),
      })
      expect(res.status).toBe(200)
      return route.info(await res.json())
    },
    async ticket(id: string) {
      const res = await call(`/${id}/connect-token`, { method: "POST", headers: { "x-kilo-ticket": "1" } })
      expect(res.status).toBe(200)
      return route.ticket(await res.json())
    },
    connect(id: string, query = "") {
      return `${url}${route.base}/${id}/connect?${route.scope(dir)}&cursor=0${query}`
    },
    remove(id: string) {
      return call(`/${id}`, { method: "DELETE" })
    },
  }
}

describe("PTY connect Origin policy", () => {
  for (const route of routes) {
    testPty(`${route.name} rejects untrusted Origin without a ticket when password auth is off`, async () => {
      await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
      await serve(undefined, async (url) => {
        const api = client(url, route, tmp.path)
        const id = await api.create()
        try {
          expect(await handshake(api.connect(id), { origin: untrusted })).toBe(403)
          expect(await handshake(api.connect(id), { origin: "null" })).toBe(403)

          // Native clients send no Origin; local, Kilo, and same-host browser origins stay allowed.
          expect(await handshake(api.connect(id))).toBe(101)
          expect(await handshake(api.connect(id), { origin: "http://localhost:3000" })).toBe(101)
          expect(await handshake(api.connect(id), { origin: "https://app.kilo.ai" })).toBe(101)
          expect(await handshake(api.connect(id), { host: "kilo.test:4096", origin: "http://kilo.test:4096" })).toBe(
            101,
          )
        } finally {
          await api.remove(id)
        }
      })
    })

    testPty(`${route.name} keeps ticket Origin checks and single-use consumption`, async () => {
      await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
      await serve(undefined, async (url) => {
        const api = client(url, route, tmp.path)
        const id = await api.create()
        try {
          expect(await handshake(api.connect(id, "&ticket=not-a-ticket"))).toBe(403)

          const blocked = await api.ticket(id)
          expect(await handshake(api.connect(id, `&ticket=${blocked}`), { origin: untrusted })).toBe(403)

          const ticket = await api.ticket(id)
          expect(await handshake(api.connect(id, `&ticket=${ticket}`), { origin: "http://localhost:3000" })).toBe(101)
          expect(await handshake(api.connect(id, `&ticket=${ticket}`), { origin: "http://localhost:3000" })).toBe(403)
        } finally {
          await api.remove(id)
        }
      })
    })

    testPty(`${route.name} still accepts password-authenticated webview connects`, async () => {
      await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
      const password = "pty-origin-secret"
      const token = Buffer.from(`kilo:${password}`).toString("base64")
      await serve(password, async (url) => {
        const api = client(url, route, tmp.path, { authorization: ServerAuth.header({ username: "kilo", password })! })
        const id = await api.create()
        try {
          // VS Code webviews connect cross-origin with auth_token; the auth middleware owns that check.
          const origin = "vscode-webview://kilo-test"
          expect(await handshake(api.connect(id, `&auth_token=${encodeURIComponent(token)}`), { origin })).toBe(101)
          expect(await handshake(api.connect(id), { origin })).toBe(401)
          expect(await handshake(api.connect(id, "&auth_token=bad"), { origin })).toBe(401)
        } finally {
          await api.remove(id)
        }
      })
    })
  }
})
