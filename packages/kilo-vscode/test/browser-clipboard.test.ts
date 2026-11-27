import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import { chromium, type Page } from "playwright-core"
import { BrowserBroker } from "../src/services/browser-automation/browser-broker"
import { executable, launchTimeout } from "./fixtures/chromium"

describe("integrated browser hover cursor and copy-button clipboard bridge", () => {
  let server: Server
  let port = 0

  beforeAll(async () => {
    const html = `<!doctype html>
      <style>
        body { margin: 0; height: 2000px; }
        button { display: block; width: 200px; height: 60px; cursor: pointer; }
        a { display: block; margin-top: 400px; width: 400px; height: 120px; background: #eef; }
      </style>
      <button id="b1" onclick="navigator.clipboard.writeText('COPIED_API')">Copy API</button>
      <button id="b2" onclick="const ta=document.createElement('textarea');ta.value='COPIED_EXEC';document.body.append(ta);ta.select();document.execCommand('copy');ta.remove()">Copy Exec</button>
      <button id="b3" onclick="navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob(['COPIED_ITEM'],{type:'text/plain'})})])">Copy Item</button>
      <a id="below" href="https://example.com">Link below fold</a>`
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" })
      res.end(html)
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const addr = server.address()
    if (!addr || typeof addr === "string") throw new Error("Missing fixture port")
    port = addr.port
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
  })

  test("bridges user-clicked Copy buttons to host clipboard, blocks background writes, and updates cursor on scroll", async () => {
    if (!executable) return
    const copied: string[] = []
    const cursors: string[] = []
    let allowed = true
    const broker = new BrowserBroker({
      log: () => {},
      useSystemChrome: () => false,
      writeClipboard: (text) => {
        copied.push(text)
      },
      launch: (config) => chromium.launch({ ...config, executablePath: executable, timeout: launchTimeout }),
    })
    broker.bind((route) => (allowed ? route : undefined))
    broker.cursors((cursor) => cursors.push(cursor.cursor))
    let rev = 0
    let lastKey = ""
    broker.subscribe((state) => {
      const key = `${state.browserId}:${state.navigation}`
      if ((state.status === "loading" || state.status === "starting") && key !== lastKey) {
        lastKey = key
        rev++
        void broker.viewport("s1", undefined, state.browserId, state.navigation, {
          width: 600,
          height: 400,
          scale: 2,
          revision: rev,
          active: true,
        })
      }
    })
    try {
      const route = { sessionId: "s1", directory: "/tmp" }
      await broker.open(route, `http://127.0.0.1:${port}/`)
      await new Promise((r) => setTimeout(r, 300))
      const state = broker.get("s1", undefined)!
      const id = { browserId: state.browserId, navigation: state.navigation, revision: rev }
      const entry = [...(broker as unknown as { entries: Map<string, { page: Page }> }).entries.values()][0]!

      // Background clipboard writes without a user gesture are blocked.
      await entry.page.evaluate(() => navigator.clipboard.writeText("BACKGROUND_HIJACK").catch(() => {}))
      await new Promise((r) => setTimeout(r, 120))
      expect(copied).toEqual([])

      const click = async (px: number, py: number) => {
        await broker.interact("s1", undefined, id, {
          kind: "pointer",
          action: "down",
          x: px / 600,
          y: py / 400,
          button: "left",
          buttons: 1,
          clicks: 1,
          modifiers: 0,
        })
        await broker.interact("s1", undefined, id, {
          kind: "pointer",
          action: "up",
          x: px / 600,
          y: py / 400,
          button: "left",
          buttons: 0,
          clicks: 1,
          modifiers: 0,
        })
        await new Promise((r) => setTimeout(r, 150))
      }

      await click(100, 30)
      await click(100, 90)
      await click(100, 150)
      expect(copied).toEqual(["COPIED_API", "COPIED_EXEC", "COPIED_ITEM"])

      // Revoking ownership blocks subsequent clipboard writes.
      allowed = false
      await click(100, 30)
      expect(copied).toEqual(["COPIED_API", "COPIED_EXEC", "COPIED_ITEM"])
      allowed = true

      // Hovering empty space and scrolling a link beneath the stationary cursor switches cursor to pointer.
      cursors.length = 0
      await broker.interact("s1", undefined, id, {
        kind: "pointer",
        action: "move",
        x: 200 / 600,
        y: 250 / 400,
        button: "left",
        buttons: 0,
        clicks: 0,
        modifiers: 0,
      })
      await new Promise((r) => setTimeout(r, 120))
      expect(cursors.at(-1)).toBe("default")
      cursors.length = 0
      await entry.page.evaluate(() => window.scrollBy(0, 350))
      await new Promise((r) => setTimeout(r, 150))
      expect(cursors).toContain("pointer")
    } finally {
      await broker.disposeAsync()
    }
  }, 25000)
})
