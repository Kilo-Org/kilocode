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
      <button id="b4" onclick="const inp=document.createElement('input');inp.style.position='fixed';inp.value='CUT_EXEC';document.body.append(inp);inp.focus();inp.select();document.execCommand('cut');inp.remove()">Cut Exec</button>
      <iframe id="sub" srcdoc="<script>window.tryHijack=()=>navigator.clipboard.writeText('IFRAME_HIJACK').catch(()=>{})</script>" style="width:1px;height:1px;border:0"></iframe>
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

      // Non-activating keys (e.g. Meta before Cmd+V) and spoofed main-world userActivation must not bypass clipboard guard.
      await broker.interact("s1", undefined, id, {
        kind: "key",
        action: "down",
        key: "Meta",
        code: "MetaLeft",
        keyCode: 91,
        modifiers: 4,
        repeat: false,
      })
      await entry.page.evaluate(() => {
        Object.defineProperty(navigator, "userActivation", { value: { isActive: true }, configurable: true })
        return navigator.clipboard.writeText("SPOOFED_HIJACK").catch(() => {})
      })
      await new Promise((r) => setTimeout(r, 120))
      expect(copied).toEqual([])
      await entry.page.evaluate(() => {
        delete (navigator as unknown as { userActivation?: unknown }).userActivation
      })

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
      await click(100, 210)
      expect(copied).toEqual(["COPIED_API", "COPIED_EXEC", "COPIED_ITEM", "CUT_EXEC"])

      // Clicking empty space arms the top-frame window, yet an embedded iframe must not hijack the clipboard.
      await click(350, 30)
      await entry.page.evaluate(() => {
        const frame = document.getElementById("sub") as HTMLIFrameElement | null
        const win = frame?.contentWindow as (Window & { tryHijack?: () => void }) | null
        if (win) {
          Object.defineProperty(win.navigator, "userActivation", { value: { isActive: true }, configurable: true })
          win.tryHijack?.()
        }
      })
      await new Promise((r) => setTimeout(r, 120))
      expect(copied).toEqual(["COPIED_API", "COPIED_EXEC", "COPIED_ITEM", "CUT_EXEC"])

      // Revoking ownership blocks subsequent clipboard writes.
      allowed = false
      await click(100, 30)
      expect(copied).toEqual(["COPIED_API", "COPIED_EXEC", "COPIED_ITEM", "CUT_EXEC"])
      allowed = true

      // Hovering button -> empty space -> scrolling a link beneath the stationary cursor switches cursor to pointer.
      await broker.interact("s1", undefined, id, {
        kind: "pointer",
        action: "move",
        x: 100 / 600,
        y: 30 / 400,
        button: "left",
        buttons: 0,
        clicks: 0,
        modifiers: 0,
      })
      await new Promise((r) => setTimeout(r, 80))
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
      await entry.page.evaluate(() => window.scrollBy(0, 450))
      await new Promise((r) => setTimeout(r, 150))
      expect(cursors).toContain("pointer")
    } finally {
      await broker.disposeAsync()
    }
  }, 25000)
})
