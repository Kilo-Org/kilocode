import assert from "node:assert/strict"
import { once } from "node:events"
import { rename, writeFile } from "node:fs/promises"
import { request } from "node:http"
import { connect } from "node:net"
import type { Duplex } from "node:stream"
import { test } from "node:test"
import type { Worker } from "node:worker_threads"
import type { BrowserProxyHandle } from "../../src/services/browser-automation/browser-proxy"
import { startBrowserProxyWorker } from "../../src/services/browser-automation/browser-proxy-client"

async function tunnel(proxy: BrowserProxyHandle): Promise<Duplex> {
  // CONNECT waits for the ClientHello, so we can hold an authenticated tunnel without contacting an upstream.
  const req = request(proxy.proxy.server, {
    method: "CONNECT",
    path: "public.example:443",
    headers: {
      "proxy-authorization":
        "Basic " + Buffer.from(`${proxy.credentials.username}:${proxy.credentials.password}`).toString("base64"),
    },
  })
  const ready = once(req, "connect")
  req.end()
  const [response, socket] = await ready
  assert.equal(response.statusCode, 200)
  socket.resume()
  return socket
}

async function assertOffline(proxy: BrowserProxyHandle) {
  const client = connect(Number(new URL(proxy.proxy.server).port), "127.0.0.1")
  try {
    await assert.rejects(once(client, "connect"), { code: "ECONNREFUSED" })
  } finally {
    client.destroy()
  }
}

test("intentional close ends authenticated tunnels and refuses new connections without reporting failure", async (t) => {
  const failure = t.mock.fn()
  const proxy = await startBrowserProxyWorker(failure)
  t.after(() => proxy.close())
  const closed = once(await tunnel(proxy), "close")
  const done = proxy.close()
  assert.equal(done, proxy.close())
  await Promise.all([closed, done])
  await assertOffline(proxy)
  assert.equal(failure.mock.callCount(), 0)
})

test("unexpected exit notifies the owner exactly once and leaves no listener", async (t) => {
  const created = new Promise<Worker>((resolve) => process.once("worker", resolve))
  const failure = t.mock.fn()
  const proxy = await startBrowserProxyWorker(failure)
  t.after(() => proxy.close())
  const worker = await created
  const closed = once(await tunnel(proxy), "close")
  await Promise.all([worker.terminate(), closed])
  assert.equal(failure.mock.callCount(), 1)
  await proxy.close()
  await assertOffline(proxy)
  assert.equal(failure.mock.callCount(), 1)
})

test("startup rejects on a missing worker entry or an early clean exit", async (t) => {
  const resolve = require.resolve
  const file = resolve("./browser-proxy-worker.js")
  await rename(file, `${file}.bak`)
  t.after(() => rename(`${file}.bak`, file))
  const failure = t.mock.fn()
  await assert.rejects(startBrowserProxyWorker(failure))
  await writeFile(file, "")
  await assert.rejects(startBrowserProxyWorker(failure), /exited before startup/)
  assert.equal(failure.mock.callCount(), 0)
})
