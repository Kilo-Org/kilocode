import { expect, it } from "bun:test"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"
import { chromium } from "playwright-core"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createAnnotationHandler } from "../src/kilo-provider/annotations"
import type { AnnotationReply, AnnotationRequest } from "../src/shared/annotations"

it("mounts real source markers with the host store in Chromium", async () => {
  const root = path.resolve(import.meta.dir, "..")
  const storage = await mkdtemp(path.join(tmpdir(), "kilo-markers-browser-"))
  const bundle = await build({
    entryPoints: [path.join(root, "tests/fixtures/annotation-markers.tsx")],
    bundle: true,
    conditions: ["browser"],
    platform: "browser",
    format: "iife",
    plugins: [solidPlugin()],
    write: false,
    outfile: "markers.js",
    logLevel: "silent",
  })
  const browser = await chromium.launch({
    executablePath: process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"],
    headless: true,
  })
  const page = await browser.newPage({ viewport: { width: 700, height: 600 } })
  const pending = new Map<string, (message: AnnotationReply) => void>()
  const handler = createAnnotationHandler({
    storage: () => storage,
    post: (message) => {
      if (!message.requestID) return
      pending.get(message.requestID)?.(message)
      pending.delete(message.requestID)
    },
  })
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  try {
    await page.exposeFunction("annotationHost", (message: AnnotationRequest) => {
      const { promise, resolve } = Promise.withResolvers<AnnotationReply>()
      pending.set(message.requestID, resolve)
      handler.handle(message)
      return promise
    })
    // A loopback origin enables the browser's real WebCrypto source digest.
    await page.route("http://localhost/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
    )
    await page.goto("http://localhost/markers")
    for (const output of bundle.outputFiles) {
      if (output.path.endsWith(".css")) await page.addStyleTag({ content: output.text })
      if (output.path.endsWith(".js")) await page.addScriptTag({ content: output.text })
    }
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    )
    expect(await page.evaluate(() => window.markers.hashes())).toBe(0)
    const first = await page.evaluate(() => window.markers.add(1))
    expect(first.number).toBe(1)
    expect(first.anchor?.start).toBe(16)
    expect(await page.evaluate(() => window.markers.hashes())).toBeGreaterThan(0)
    await page
      .locator(".annotation-marker-badge")
      .waitFor()
      .catch(async (error: Error) => {
        throw new Error(
          `${error.message}\nPage errors: ${errors.join("; ")}\n${await page.locator("[data-transcript-root]").innerHTML()}`,
        )
      })
    expect(await page.locator(".annotation-marker-badge").textContent()).toBe("#1")
    const single = await page.locator(".annotation-marker-cluster").evaluate((element) => ({
      height: element.clientHeight,
      scroll: element.scrollHeight,
      badge: element.querySelector("button")!.getBoundingClientRect().height,
    }))
    expect(single.badge).toBe(20)
    expect(single.scroll).toBeLessThanOrEqual(single.height)
    expect(await page.locator(".annotation-marker-badge").getAttribute("aria-label")).toBe("Annotation #1")
    expect(await page.evaluate(() => window.markers.selection())).toBe("repeat target")
    expect(await page.locator("[data-transcript-root]").textContent()).not.toContain("#1")
    const before = await page.locator(".annotation-marker-badge").boundingBox()
    await page.evaluate(() => window.markers.scroll(20))
    await page.waitForFunction(
      (top) => document.querySelector<HTMLElement>(".annotation-marker-badge")!.getBoundingClientRect().top < top!,
      before?.y,
    )
    await page.evaluate(() => window.markers.wrap())
    await page.locator(".annotation-marker-badge").waitFor()
    const anchored = await page.evaluate(() => window.markers.anchoredOffset())
    expect(anchored?.quote).toBe("repeat target")
    expect(anchored?.offset).toBe(0)
    expect(await page.evaluate(() => window.markers.send())).toBe(false)
    await page.evaluate(() => window.markers.reload())
    expect(await page.locator(".annotation-marker-badge").textContent()).toBe("#1")
    await page.evaluate(() => window.markers.change(true))
    await page.waitForFunction(() => !document.querySelector(".annotation-marker-badge"))
    await page.evaluate(() => window.markers.change(false))
    await page.locator(".annotation-marker-badge").waitFor()
    await page.evaluate(() => window.markers.show(false))
    await page.waitForFunction(() => !document.querySelector(".annotation-marker-badge"))
    await page.evaluate(() => window.markers.show(true))
    await page.locator(".annotation-marker-badge").waitFor()
    await page.evaluate(() => window.markers.scope("ses_b"))
    await page.evaluate(() => window.markers.reload())
    expect(await page.locator(".annotation-marker-badge").count()).toBe(0)
    await page.evaluate(() => window.markers.scope("ses_a"))
    await page.evaluate(() => window.markers.reload())
    await page.locator(".annotation-marker-badge").waitFor()
    const second = await page.evaluate(() => window.markers.add(0))
    expect(second.number).toBe(2)
    expect(second.anchor?.start).toBe(0)
    await page.waitForFunction(() => document.querySelectorAll(".annotation-marker-badge").length === 2)
    expect(await page.locator(".annotation-marker-badge").allTextContents()).toEqual(["#1", "#2"])
    const idle = await page.evaluate(async () => {
      let count = 0
      const observer = new MutationObserver(() => count++)
      observer.observe(document.querySelector(".annotation-markers")!, {
        subtree: true,
        childList: true,
        attributes: true,
      })
      await new Promise((resolve) => setTimeout(resolve, 150))
      observer.disconnect()
      return count
    })
    expect(idle).toBeLessThan(3)
    // Three coincident notes must never cover one another, including near the visible bottom edge.
    await page.evaluate(() => window.markers.scope("ses_cluster"))
    const layout = () =>
      page.evaluate(() => {
        const root = document.querySelector<HTMLElement>("[data-transcript-root]")!
        const paragraph = root.querySelector("p")!
        return {
          text: root.textContent,
          width: paragraph.getBoundingClientRect().width,
          height: paragraph.getBoundingClientRect().height,
          scrollHeight: root.scrollHeight,
        }
      })
    const original = await layout()
    for (let index = 0; index < 3; index++) await page.evaluate(() => window.markers.add(1))
    const accessible = async () => {
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      )
      await page.waitForFunction(() => document.querySelectorAll(".annotation-marker-badge").length === 3)
      expect(
        await page.locator(".annotation-marker-badge").evaluateAll((buttons) => {
          const rects = buttons.map((button) => button.getBoundingClientRect())
          return rects.every((rect, index) =>
            rects
              .slice(index + 1)
              .every(
                (other) =>
                  rect.right <= other.left ||
                  rect.left >= other.right ||
                  rect.bottom <= other.top ||
                  rect.top >= other.bottom,
              ),
          )
        }),
      ).toBe(true)
      for (const number of [1, 2, 3]) {
        const badge = page.getByRole("button", { name: `Annotation #${number}`, exact: true })
        await badge.focus()
        const placement = await badge.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          const root = document.querySelector("[data-transcript-root]")!.getBoundingClientRect()
          return {
            rect: rect.toJSON(),
            bounds: root.toJSON(),
            hit: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.tagName,
            visible:
              rect.top >= Math.max(0, root.top) &&
              rect.bottom <= Math.min(window.innerHeight, root.bottom) &&
              rect.left >= Math.max(0, root.left) &&
              rect.right <= Math.min(window.innerWidth, root.right) &&
              element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
          }
        })
        expect(placement.visible, JSON.stringify({ number, ...placement })).toBe(true)
      }
    }
    await accessible()
    expect(await layout()).toEqual(original)
    await page.setViewportSize({ width: 700, height: 120 })
    await accessible()
    expect(await layout()).toEqual(original)
    await page.setViewportSize({ width: 700, height: 600 })
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("[data-transcript-root]")!
      const paragraph = root.querySelector("p")!.getBoundingClientRect()
      root.style.height = `${paragraph.top - root.getBoundingClientRect().top + 24}px`
    })
    const edge = await layout()
    await accessible()
    expect(await layout()).toEqual(edge)
    // A viewport too short to display all badges must still allow keyboard access to every number.
    await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("[data-transcript-root]")!
      root.scrollTop += root.querySelector("p")!.getBoundingClientRect().top - root.getBoundingClientRect().top
      root.style.height = "24px"
    })
    await accessible()
    await page.evaluate(() => window.markers.dispose())
    expect(await page.locator(".annotation-markers").count()).toBe(0)
    expect(errors).toEqual([])
  } finally {
    handler.dispose()
    await browser.close()
    await rm(storage, { recursive: true, force: true })
  }
}, 60_000)
