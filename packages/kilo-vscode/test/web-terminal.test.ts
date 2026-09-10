import { expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { connect, type AddressInfo } from "node:net"
import { createServer } from "node:http"
import { launch } from "../../kilo-cli/src/interactive-server"
import type { Layout } from "../../kilo-cli/src/paths"
import { fixture } from "../../kilo-cli/test/fixture"
import { connectV2 } from "../src/connection"
import { startWebServer, type WebHost } from "../src/web-server"

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

function rawWsRequest(
  host: WebHost,
  requestPath: string,
  extraHeaders: string[] = [],
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolveProbe, rejectProbe) => {
    const port = Number(new URL(host.url).port)
    const socket = connect(port, "127.0.0.1", () => {
      const headers = [
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
        ...extraHeaders,
      ]
      socket.write(`GET ${requestPath} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${headers.join("\r\n")}\r\n\r\n`)
    })
    let raw = ""
    socket.on("data", (chunk: Buffer) => {
      raw += String(chunk)
    })
    socket.on("close", () => {
      const lines = raw.split("\r\n")
      const status = Number(lines[0]?.split(" ")[1] ?? 0)
      const headers: Record<string, string> = {}
      let bodyIndex = 0
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] === "") {
          bodyIndex = i + 1
          break
        }
        const sepIdx = lines[i].indexOf(":")
        if (sepIdx !== -1) {
          headers[lines[i].slice(0, sepIdx).trim().toLowerCase()] = lines[i].slice(sepIdx + 1).trim()
        }
      }
      const body = lines.slice(bodyIndex).join("\r\n")
      resolveProbe({ status, headers, body })
    })
    socket.on("error", rejectProbe)
  })
}

test("web-server proxies native v2 terminal ticket path and enforces security guards", async () => {
  await using input = await fixture()
  const layout = interactiveLayout(path.join(input.directory, "terminal-test"), input.home)
  const assetsDir = mkdtempSync(path.join(tmpdir(), "kilo-web-term-"))
  writeFileSync(path.join(assetsDir, "index.html"), "<html><body>app</body></html>")

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* launch(layout, { models: false, recover: false })
        const webHost = yield* Effect.promise(() =>
          startWebServer({
            assets: assetsDir,
            serverUrl: server.url,
            serverPassword: server.auth.password,
          }),
        )

        try {
          yield* Effect.promise(async () => {
            // Connect to real server and preview web host
            const serverConn = await connectV2({ url: server.url, password: server.auth.password })
            const preview = await connectV2({ url: webHost.url, password: webHost.password })
            expect(preview.health.healthy).toBe(true)

            // 1. Create a session on the real server
            const session = await serverConn.client.session.create({ location: { directory: input.directory } })
            expect(session.id).toBeDefined()

            // 2. Create a persistent PTY terminal
            const pty = await serverConn.client.experimental.persistentPty.create({
              sessionID: session.id,
              command: "sh",
              args: [],
              title: "test-sh",
              env: {},
            })
            expect(pty.id).toBeDefined()

            // 3. Issue a connect-token via authenticated HTTP through the web-server preview proxy
            const tokenRes = await preview.client.experimental.persistentPty.connectToken({
              ptyID: pty.id,
              "x-opencode-ticket": "1",
            })
            expect(typeof tokenRes.ticket).toBe("string")
            expect(tokenRes.ticket.length).toBeGreaterThan(0)

            // 4. Positive control: Connect WebSocket through webHost with valid ticket and preview origin
            const wsUrl = `${webHost.url.replace("http:", "ws:")}/api/experimental/persistent-pty/${encodeURIComponent(pty.id)}/connect?ticket=${encodeURIComponent(tokenRes.ticket)}&cursor=0&attachment_id=att_1`
            type ExtendedWebSocket = new (url: string, protocols?: unknown) => WebSocket
            const ws = new (WebSocket as unknown as ExtendedWebSocket)(wsUrl, {
              headers: {
                origin: webHost.url,
              },
            })

            const opened = Promise.withResolvers<void>()
            const receivedMessages: string[] = []
            const gotAttached = Promise.withResolvers<void>()
            const gotEcho = Promise.withResolvers<void>()

            ws.onopen = () => opened.resolve()
            ws.onmessage = (event) => {
              const text =
                typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
              receivedMessages.push(text)
              if (text.includes('"type":"attached"')) {
                gotAttached.resolve()
              }
              if (text.includes("hello-terminal-ws")) {
                gotEcho.resolve()
              }
            }
            ws.onerror = (err) => {
              opened.reject(err)
              gotAttached.reject(err)
              gotEcho.reject(err)
            }

            // Await successful WebSocket open and initial attached frame
            await opened.promise
            await gotAttached.promise

            // Send terminal input through the WebSocket
            ws.send("echo hello-terminal-ws\n")
            await gotEcho.promise

            // Clean up WebSocket
            ws.close()

            // 5. Negative controls:

            // Negative A: Missing ticket on WebSocket upgrade -> 403 Forbidden before upstream
            const noTicket = await rawWsRequest(
              webHost,
              `/api/experimental/persistent-pty/${pty.id}/connect`,
              [`Origin: ${webHost.url}`],
            )
            expect(noTicket.status).toBe(403)

            // Negative B: Foreign origin -> 403 Forbidden before upstream
            const foreignOrigin = await rawWsRequest(
              webHost,
              `/api/experimental/persistent-pty/${pty.id}/connect?ticket=some-ticket`,
              ["Origin: https://malicious.example.com"],
            )
            expect(foreignOrigin.status).toBe(403)

            // Negative C: Missing origin header -> 403 Forbidden before upstream
            const missingOrigin = await rawWsRequest(
              webHost,
              `/api/experimental/persistent-pty/${pty.id}/connect?ticket=some-ticket`,
              [],
            )
            expect(missingOrigin.status).toBe(403)

            // Negative D: Disallowed path -> 403 Forbidden before upstream
            const badPath = await rawWsRequest(
              webHost,
              `/api/session/connect?ticket=some-ticket`,
              [`Origin: ${webHost.url}`],
            )
            expect(badPath.status).toBe(403)

            // Negative E: Invalid / expired ticket with valid origin -> upstream rejects with 403 (no fallback)
            const invalidTicket = await rawWsRequest(
              webHost,
              `/api/experimental/persistent-pty/${pty.id}/connect?ticket=invalid-ticket-val`,
              [`Origin: ${webHost.url}`],
            )
            expect(invalidTicket.status).toBe(403)

            // Negative F: Non-origin-form (absolute URI) request target -> 400 Bad Request before upstream
            const absoluteTarget = await rawWsRequest(
              webHost,
              `http://evil.com/api/experimental/persistent-pty/${pty.id}/connect?ticket=some-ticket`,
              [`Origin: ${webHost.url}`],
            )
            expect(absoluteTarget.status).toBe(400)

            // 6. Security verification: Verify WebSocket upgrade upstream request does NOT contain real server secret
            // Issue another valid ticket and check that raw request passes upstream without authorization header
            const tokenRes2 = await preview.client.experimental.persistentPty.connectToken({
              ptyID: pty.id,
              "x-opencode-ticket": "1",
            })
            expect(tokenRes2.ticket).toBeDefined()

            // Tear down terminal
            await serverConn.client.experimental.persistentPty.remove({ ptyID: pty.id })
          })
        } finally {
          yield* Effect.promise(() => webHost.close())
          yield* Effect.promise(() => rm(assetsDir, { recursive: true, force: true }))
        }
      }),
    ),
  )
})

test("web-server upgrade forwarding never injects server or preview credentials to upstream", async () => {
  const assetsDir = mkdtempSync(path.join(tmpdir(), "kilo-web-term-sec-"))
  writeFileSync(path.join(assetsDir, "index.html"), "<html><body>app</body></html>")

  let forwardedHeaders: Record<string, string | string[] | undefined> = {}
  const upstreamReceived = Promise.withResolvers<void>()

  const upstream = createServer((_req, res) => res.end())
  upstream.on("upgrade", (req, socket) => {
    forwardedHeaders = { ...req.headers }
    socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
    socket.destroy()
    upstreamReceived.resolve()
  })

  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r))
  const upstreamPort = (upstream.address() as AddressInfo).port

  const webHost = await startWebServer({
    assets: assetsDir,
    serverUrl: `http://127.0.0.1:${upstreamPort}`,
    serverPassword: "super-secret-password-xyz",
  })

  try {
    const res = await rawWsRequest(
      webHost,
      "/api/experimental/persistent-pty/pty_test/connect?ticket=valid-ticket-123",
      [`Origin: ${webHost.url}`],
    )
    expect(res.status).toBe(101)
    await upstreamReceived.promise

    // Upstream MUST NOT receive any authorization header or server credentials
    expect(forwardedHeaders.authorization).toBeUndefined()
    expect(forwardedHeaders["proxy-authorization"]).toBeUndefined()
    expect(JSON.stringify(forwardedHeaders)).not.toContain("super-secret-password-xyz")
    expect(JSON.stringify(forwardedHeaders)).not.toContain(webHost.password)

    // Expected preview Origin and Host are forwarded correctly
    expect(forwardedHeaders.origin).toBe(webHost.url)
    expect(forwardedHeaders.host).toBe(`127.0.0.1:${upstreamPort}`)
    expect(String(forwardedHeaders.upgrade).toLowerCase()).toBe("websocket")
  } finally {
    await webHost.close()
    await new Promise<void>((r) => upstream.close(() => r()))
    await rm(assetsDir, { recursive: true, force: true })
  }
})
