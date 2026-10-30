import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { TCPSocketListener } from "bun"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { desktop } from "./desktop"

let root: string
let echo: TCPSocketListener<undefined>
let app: ReturnType<typeof desktop>
let base: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kilo-desktop-"))
  await mkdir(join(root, "core"))
  await mkdir(join(root, "vendor"))
  await writeFile(join(root, "core", "rfb.js"), "export default class RFB {}\n")
  await writeFile(join(root, "vendor", "style.css"), "body { color: #ddd; }\n")
  echo = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, chunk) {
        socket.write(chunk)
      },
    },
  })
  app = desktop({ host: "127.0.0.1", port: 0, vnc: echo.port, novnc: root })
  base = `http://127.0.0.1:${app.server.port}`
})

afterAll(async () => {
  await app.close()
  await echo.stop(true)
  await rm(root, { recursive: true, force: true })
})

async function session() {
  const res = await fetch(`${base}/channel`, { method: "POST", headers: { Origin: base } })
  expect(res.status).toBe(200)
  return ((await res.json()) as { id: string }).id
}

async function read(id: string, size: number) {
  const parts: Uint8Array[] = []
  let total = 0
  while (total < size) {
    const res = await fetch(`${base}/channel/${id}`)
    if (res.status === 204) continue
    expect(res.status).toBe(200)
    const bytes = new Uint8Array(await res.arrayBuffer())
    parts.push(bytes)
    total += bytes.byteLength
  }
  return Buffer.concat(parts, total)
}

describe("desktop", () => {
  test("serves the viewer and its asset, and returns 404 elsewhere", async () => {
    const index = await fetch(`${base}/`)
    expect(index.status).toBe(200)
    expect(index.headers.get("content-type")).toContain("text/html")
    const html = await index.text()
    expect(html).toContain("IntelliJ Desktop")
    expect(html).toContain("/core/rfb.js")
    expect(html).toContain("/http.js")
    expect(html).not.toContain("websocket")

    const script = await fetch(`${base}/http.js`)
    expect(script.status).toBe(200)
    expect(script.headers.get("content-type")).toContain("javascript")
    expect(await script.text()).toContain("class Channel")

    expect((await fetch(`${base}/missing`)).status).toBe(404)
    expect((await fetch(`${base}/core/missing.js`)).status).toBe(404)
    expect((await fetch(`${base}/core/`)).status).toBe(404)
  })

  test("serves only core and vendor files from the noVNC root", async () => {
    const core = await fetch(`${base}/core/rfb.js`)
    expect(core.status).toBe(200)
    expect(core.headers.get("content-type")).toContain("javascript")
    expect(await core.text()).toContain("class RFB")

    const vendor = await fetch(`${base}/vendor/style.css`)
    expect(vendor.status).toBe(200)
    expect(vendor.headers.get("content-type")).toContain("css")
    expect(await vendor.text()).toContain("#ddd")

    expect((await fetch(`${base}/util/browser.js`)).status).toBe(404)
    expect((await fetch(`${base}/core/..%2f..%2fetc%2fpasswd`)).status).toBe(404)
    expect((await fetch(`${base}/vendor/%2e%2e/%2e%2e/package.json`)).status).toBe(404)
  })

  test("rejects cross-origin mutations and never trusts X-Forwarded-Host", async () => {
    const res = await fetch(`${base}/channel`, {
      method: "POST",
      headers: { Origin: "http://evil.example", "X-Forwarded-Host": "evil.example" },
    })
    expect(res.status).toBe(403)
    expect(res.headers.get("access-control-allow-origin")).toBeNull()
    expect(await res.text()).toContain("Origin denied")
  })

  test("accepts an explicit trusted origin against a rewritten host", async () => {
    const trusted = "https://preview.example"
    const preview = desktop({ host: "127.0.0.1", port: 0, vnc: echo.port, novnc: root, origin: trusted })
    const previewBase = `http://127.0.0.1:${preview.server.port}`
    try {
      const res = await fetch(`${previewBase}/channel`, {
        method: "POST",
        headers: { Origin: trusted, "X-Forwarded-Host": "rewritten.example" },
      })
      expect(res.status).toBe(200)
      const id = ((await res.json()) as { id: string }).id
      const del = await fetch(`${previewBase}/channel/${id}`, {
        method: "DELETE",
        headers: { Origin: trusted },
      })
      expect(del.status).toBe(204)

      const denied = await fetch(`${previewBase}/channel`, {
        method: "POST",
        headers: { Origin: "https://evil.example", "X-Forwarded-Host": "evil.example" },
      })
      expect(denied.status).toBe(403)
    } finally {
      await preview.close()
    }
  })

  test("preserves bytes and batches input into the VNC stream", async () => {
    const id = await session()
    const first = new Uint8Array([0, 1, 2, 127, 128])
    const second = new Uint8Array([255, 10, 13, 0])
    for (const chunk of [first, second]) {
      const res = await fetch(`${base}/channel/${id}`, { method: "POST", body: chunk, headers: { Origin: base } })
      expect(res.status).toBe(204)
    }
    const bytes = await read(id, first.byteLength + second.byteLength)
    expect([...bytes]).toEqual([...first, ...second])
  })

  test("closes a session and rejects later reads", async () => {
    const id = await session()
    const del = await fetch(`${base}/channel/${id}`, { method: "DELETE", headers: { Origin: base } })
    expect(del.status).toBe(204)
    expect((await fetch(`${base}/channel/${id}`)).status).toBe(410)
    const post = await fetch(`${base}/channel/${id}`, {
      method: "POST",
      body: new Uint8Array([1]),
      headers: { Origin: base },
    })
    expect(post.status).toBe(410)
  })

  test("resolves a pending read when its session closes", async () => {
    const id = await session()
    const read = fetch(`${base}/channel/${id}`)
    await Bun.sleep(25)
    const del = await fetch(`${base}/channel/${id}`, { method: "DELETE", headers: { Origin: base } })
    expect(del.status).toBe(204)
    expect((await read).status).toBe(410)
  })

  test("reports a failed VNC connect without creating a session", async () => {
    const dead = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket) {
          socket.end()
        },
      },
    })
    const vnc = dead.port
    const app = desktop({ host: "127.0.0.1", port: 0, vnc, novnc: root })
    await dead.stop(true)
    const origin = `http://127.0.0.1:${app.server.port}`
    const res = await fetch(`${origin}/channel`, { method: "POST", headers: { Origin: origin } })
    expect(res.status).toBe(502)
    expect((await fetch(`${origin}/channel/none`)).status).toBe(410)
    await app.close()
  })
})
