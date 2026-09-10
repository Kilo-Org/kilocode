// Node-runtime validation for the web host: the VS Code extension host runs
// Node, not Bun, so the disconnect semantics must hold under actual Node.
// Run: node --experimental-strip-types test/web-server.node.validate.mjs
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { connect } from "node:net"
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { startWebServer } from "../src/web-server.ts"

const basic = (password) => `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`

function withUpstream(handler) {
  const hits = { count: 0 }
  const upstream = createServer((req, res) => {
    hits.count++
    handler(req, res, hits)
  })
  return {
    ready: new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve)),
    url: () => `http://127.0.0.1:${upstream.address().port}`,
    close: () => new Promise((resolve) => upstream.close(resolve)),
    hits,
  }
}

async function withHost(upstreamUrl) {
  const assetsDir = mkdtempSync(path.join(tmpdir(), "kilo-web-host-node-"))
  writeFileSync(path.join(assetsDir, "index.html"), "<html><body>app</body></html>")
  mkdirSync(path.join(assetsDir, "assets"))
  writeFileSync(path.join(assetsDir, "assets", "app-abc.js"), "console.log(1)")
  symlinkSync(new URL("../src/web-server.ts", import.meta.url).pathname, path.join(assetsDir, "link-escape.js"))
  const host = await startWebServer({
    assets: assetsDir,
    serverUrl: upstreamUrl,
    serverPassword: "server-secret",
  })
  return {
    host,
    cleanup: async () => {
      await host.close()
      await rm(assetsDir, { recursive: true, force: true })
    },
  }
}

const authed = (host) => ({ authorization: basic(host.password) })
const checks = []
const check = (name, run) =>
  checks.push(async () => {
    await run()
    console.log(`ok - ${name}`)
  })

await check("refuses unauthenticated api requests before any upstream hit", async () => {
  const upstream = withUpstream((req, res, hits) => {
    hits.count++
    res.end("unreachable")
  })
  await upstream.ready
  const { host, cleanup } = await withHost(upstream.url())
  try {
    const before = upstream.hits.count
    const response = await fetch(`${host.url}/api/health`)
    assert.equal(response.status, 401)
    assert.equal(upstream.hits.count, before)
  } finally {
    await cleanup()
    await upstream.close()
  }
})

await check("proxies with the real upstream credential and never exposes it", async () => {
  let seenAuthorization
  const upstream = withUpstream((req, res) => {
    seenAuthorization = req.headers.authorization
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ healthy: true }))
  })
  await upstream.ready
  const { host, cleanup } = await withHost(upstream.url())
  try {
    assert.ok(!host.url.includes("server-secret"))
    const response = await fetch(`${host.url}/api/health`, { headers: authed(host) })
    assert.equal(response.status, 200)
    assert.equal(seenAuthorization, basic("server-secret"))
  } finally {
    await cleanup()
    await upstream.close()
  }
})

await check("normal streaming completion is not aborted by node request-close semantics", async () => {
  let upstreamClosed = 0
  const upstream = withUpstream((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" })
    res.write("event: ping\ndata: 1\n\n")
    req.on("close", () => {
      upstreamClosed++
    })
    setTimeout(() => {
      res.write("event: ping\ndata: 2\n\n")
      res.end()
    }, 150)
  })
  await upstream.ready
  const { host, cleanup } = await withHost(upstream.url())
  try {
    const response = await fetch(`${host.url}/api/event`, { headers: authed(host) })
    assert.equal(response.status, 200)
    const body = await response.text()
    assert.match(body, /data: 1/)
    assert.match(body, /data: 2/)
    assert.equal(upstreamClosed, 0)
  } finally {
    await cleanup()
    await upstream.close()
  }
})

await check("client abort tears down the upstream request under node", async () => {
  let upstreamClosed = 0
  const upstream = withUpstream((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" })
    res.write("event: ping\ndata: 1\n\n")
    req.on("close", () => {
      upstreamClosed++
    })
  })
  await upstream.ready
  const { host, cleanup } = await withHost(upstream.url())
  try {
    const controller = new AbortController()
    const response = await fetch(`${host.url}/api/event`, {
      headers: authed(host),
      signal: controller.signal,
    })
    assert.equal(response.status, 200)
    await response.body.getReader().read()
    controller.abort()
    for (let attempt = 0; attempt < 200 && upstreamClosed === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(upstreamClosed, 1)
  } finally {
    await cleanup()
    await upstream.close()
  }
})

await check("refuses traversal and symlink escapes under node", async () => {
  const upstream = withUpstream((req, res) => res.end())
  await upstream.ready
  const { host, cleanup } = await withHost(upstream.url())
  try {
    const encoded = await fetch(`${host.url}/%2e%2e/%2e%2e/etc/passwd`, { headers: authed(host) })
    assert.ok(encoded.status === 403 || encoded.status === 404)
    const escape = await fetch(`${host.url}/link-escape.js`, { headers: authed(host) })
    assert.equal(escape.status, 403)
  } finally {
    await cleanup()
    await upstream.close()
  }
})

function rawRequest(host, requestPath, headers = "Connection: close") {
  return new Promise((resolveProbe, rejectProbe) => {
    const port = Number(new URL(host.url).port)
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(`GET ${requestPath} HTTP/1.1\r\nHost: 127.0.0.1\r\n${headers}\r\n\r\n`)
    })
    let raw = ""
    socket.on("data", (chunk) => {
      raw += String(chunk)
    })
    socket.on("close", () => {
      const status = Number(raw.split(" ")[1] ?? 0)
      const body = raw.split("\r\n\r\n").slice(1).join("\r\n\r\n")
      resolveProbe({ status, body })
    })
    socket.on("error", rejectProbe)
  })
}

await check("refuses invalid terminal upgrades under node", async () => {
  const upstream = withUpstream((req, res) => res.end())
  await upstream.ready
  const { host, cleanup } = await withHost(upstream.url())
  try {
    const noTicket = await rawRequest(
      host,
      "/api/pty/example/connect",
      `Connection: Upgrade\r\nUpgrade: websocket\r\nOrigin: ${host.url}`,
    )
    assert.equal(noTicket.status, 403)

    const foreignOrigin = await rawRequest(
      host,
      "/api/pty/example/connect?ticket=t1",
      "Connection: Upgrade\r\nUpgrade: websocket\r\nOrigin: https://evil.example.com",
    )
    assert.equal(foreignOrigin.status, 403)

    const noOrigin = await rawRequest(
      host,
      "/api/pty/example/connect?ticket=t1",
      "Connection: Upgrade\r\nUpgrade: websocket",
    )
    assert.equal(noOrigin.status, 403)

    const badPath = await rawRequest(
      host,
      "/api/session/connect?ticket=t1",
      `Connection: Upgrade\r\nUpgrade: websocket\r\nOrigin: ${host.url}`,
    )
    assert.equal(badPath.status, 403)

    const absoluteTarget = await rawRequest(
      host,
      "http://evil.com/api/pty/example/connect?ticket=t1",
      `Connection: Upgrade\r\nUpgrade: websocket\r\nOrigin: ${host.url}`,
    )
    assert.equal(absoluteTarget.status, 400)
  } finally {
    await cleanup()
    await upstream.close()
  }
})

console.log(`node validation passed: ${checks.length} checks`)
process.exit(0)
