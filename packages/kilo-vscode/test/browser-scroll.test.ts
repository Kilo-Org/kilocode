import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chromium, type Browser } from "playwright-core"
import { SCROLL_HELPER } from "../src/services/browser-automation/browser-scroll"
import { executable, launchTimeout } from "./fixtures/chromium"

describe("isolated-world browser scroll helper", () => {
  let browser: Browser | undefined

  beforeAll(async () => {
    if (!executable) return
    browser = await chromium.launch({ executablePath: executable, headless: true, timeout: launchTimeout })
  }, launchTimeout + 5000)

  afterAll(async () => {
    await browser?.close()
  })

  test("scrolls nested containers, chains through non-scrollable same-origin iframes, respects preventDefault, and falls back on Ctrl+wheel", async () => {
    if (!browser) return
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
    try {
      await page.setContent(`
        <style>
          html, body { margin: 0; height: 2000px; }
          #box { position: fixed; left: 0; top: 0; width: 120px; height: 100px; overflow-y: auto; }
          #box-inner { height: 250px; }
          #ad { position: fixed; left: 140px; top: 0; width: 120px; height: 100px; border: 0; }
          #map { position: fixed; left: 280px; top: 0; width: 100px; height: 100px; }
        </style>
        <div id="box"><div id="box-inner"></div></div>
        <iframe id="ad" srcdoc="<style>body{margin:0;height:80px}</style><div>banner</div>"></iframe>
        <div id="map"></div>
        <script>
          window.mapWheel = 0
          document.getElementById("map").addEventListener("wheel", (event) => {
            event.preventDefault()
            window.mapWheel += event.deltaY
          }, { passive: false })
        </script>
      `)
      await page.waitForTimeout(100)
      const cdp = await page.context().newCDPSession(page)
      const { frameTree } = await cdp.send("Page.getFrameTree")
      const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
        frameId: frameTree.frame.id,
        worldName: "kilo-scroll-test",
      })
      await cdp.send("Runtime.evaluate", { contextId: executionContextId, expression: SCROLL_HELPER })
      const scroll = async (x: number, y: number, dy: number, mods = 0) => {
        const res = await cdp.send("Runtime.evaluate", {
          contextId: executionContextId,
          expression: `globalThis.__kiloScroll(${x},${y},0,${dy},${mods})`,
          returnByValue: true,
        })
        return res.result.value
      }

      // 1. Nested scrollable container scrolls first, then chains remainder to root.
      expect(await scroll(50, 50, 100)).toBe(true)
      expect(await page.evaluate(() => [document.getElementById("box")!.scrollTop, window.scrollY])).toEqual([100, 0])
      expect(await scroll(50, 50, 100)).toBe(true)
      expect(await page.evaluate(() => [document.getElementById("box")!.scrollTop, window.scrollY])).toEqual([150, 50])

      // 2. Non-scrollable same-origin iframe (such as a banner ad) chains scroll to the parent page.
      expect(await scroll(200, 50, 120)).toBe(true)
      expect(await page.evaluate(() => window.scrollY)).toBe(170)

      // 3. Elements with preventDefault() receive the wheel event and suppress default page scrolling.
      expect(await scroll(320, 50, 80)).toBe(true)
      expect(await page.evaluate(() => [(window as unknown as { mapWheel: number }).mapWheel, window.scrollY])).toEqual([
        80,
        170,
      ])

      // 4. Ctrl+wheel (zoom) returns false so the worker delegates to native CDP mouseWheel.
      expect(await scroll(50, 50, -50, 2)).toBe(false)
    } finally {
      await page.close()
    }
  }, 15000)
})
