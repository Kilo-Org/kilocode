import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { chromium, type Browser, type Locator, type Page } from "@playwright/test"
import { serve } from "./fixtures/response-lens-visual-server"

const output = path.join(tmpdir(), "kilo", "response-lens-visual")
let server: Awaited<ReturnType<typeof serve>>
let browser: Browser

beforeAll(async () => {
  server = await serve()
  browser = await chromium.launch({ executablePath: process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"], headless: true })
  await mkdir(output, { recursive: true })
}, 60_000)
afterAll(async () => {
  await browser?.close()
  await server?.stop(true)
})

async function select(page: Page) {
  await page.locator("#selection").evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    document.dispatchEvent(new Event("selectionchange"))
  })
  await page.locator(".selection-toolbar[data-positioned]").waitFor()
}

async function contrast(locator: Locator) {
  return locator.evaluate((element) => {
    const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number)
    const blend = (foreground: number[], background: number[]) => {
      const alpha = foreground[3] ?? 1
      return foreground.slice(0, 3).map((value, index) => value * alpha + background[index]! * (1 - alpha))
    }
    const parents: Element[] = []
    for (let current: Element | null = element; current; current = current.parentElement) parents.unshift(current)
    const background = parents.reduce(
      (color, parent) => blend(rgb(getComputedStyle(parent).backgroundColor), color),
      [255, 255, 255],
    )
    const foreground = blend(rgb(getComputedStyle(element).color), background)
    const luminance = (color: number[]) =>
      color.reduce((sum, value, index) => {
        const channel = value / 255
        return (
          sum +
          (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]!
        )
      }, 0)
    const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b)
    return (values[1]! + 0.05) / (values[0]! + 0.05)
  })
}

async function readable(locator: Locator) {
  const ratio = await contrast(locator)
  if (ratio < 4.5)
    console.error(
      await locator.evaluate((element) => {
        const ancestors = []
        for (let current: Element | null = element; current; current = current.parentElement) {
          const style = getComputedStyle(current)
          ancestors.push({
            tag: current.tagName,
            class: current.className,
            color: style.color,
            background: style.backgroundColor,
          })
        }
        return ancestors
      }),
    )
  expect(ratio).toBeGreaterThanOrEqual(4.5)
}

describe("Response Lens real browser styles", () => {
  it.each(["light-modern", "dark-modern", "hc-black", "hc-light", "paired-tokens"])(
    "renders readable compact controls in %s",
    async (theme) => {
      const page = await browser.newPage({ viewport: { width: 420, height: 760 }, reducedMotion: "reduce" })
      const errors: string[] = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort(),
      )
      try {
        await page.goto(`${server.url}?theme=${theme === "paired-tokens" ? "dark-modern" : theme}`)
        const toggle = page.locator(".prompt-annotations-toggle")
        const list = page.locator(".prompt-annotations-list")
        await toggle.waitFor()
        if (theme === "paired-tokens")
          await page.evaluate(() => {
            const pairs = {
              "--vscode-button-background": "#e4d800",
              "--vscode-button-hoverBackground": "#fff180",
              "--vscode-button-foreground": "#151515",
              "--vscode-button-secondaryBackground": "#19273f",
              "--vscode-button-secondaryHoverBackground": "#253856",
              "--vscode-button-secondaryForeground": "#ffffff",
              "--vscode-input-background": "#edf1f9",
              "--vscode-input-foreground": "#161f31",
            }
            for (const [key, value] of Object.entries(pairs)) document.documentElement.style.setProperty(key, value)
          })
        await toggle.focus()
        expect(await list.isVisible()).toBe(false)
        await toggle.press("Enter")
        expect(await list.isVisible()).toBe(true)
        await toggle.press("Space")
        expect(await list.isVisible()).toBe(false)
        await toggle.hover()
        expect(await list.isVisible()).toBe(false)

        await select(page)
        const toolbar = page.locator(".selection-toolbar")
        for (const button of await toolbar.locator("button").all()) {
          await readable(button)
          await button.hover()
          await readable(button)
          await button.focus()
          await readable(button)
        }
        expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(34)
        await page.screenshot({ path: path.join(output, `${theme}-toolbar.png`) })
        await toolbar.getByRole("button", { name: "Annotate", exact: true }).click()
        const editor = page.locator(".annotation-popover")
        const textarea = editor.locator("textarea")
        await textarea.fill("A new annotation without opening the pending list.")
        expect(await list.isVisible()).toBe(false)
        await readable(textarea)
        await readable(editor.locator(".annotation-popover-selection"))
        for (const button of await editor.locator("button").all()) {
          await readable(button)
          await button.hover()
          await readable(button)
          await button.focus()
          await readable(button)
        }
        await textarea.focus()
        await page.screenshot({ path: path.join(output, `${theme}-annotation.png`) })
        await textarea.press("Escape")
        await page.waitForFunction(() => document.activeElement?.matches(".visual-dock textarea"))
        expect(await editor.isVisible()).toBe(false)
        expect(await list.isVisible()).toBe(false)

        await toggle.press("Enter")
        await list.getByRole("button", { name: "Edit", exact: true }).click()
        await textarea.fill("Unsaved changes should not replace the saved note")
        expect(await list.isVisible()).toBe(false)
        await textarea.press("Escape")
        await page.waitForFunction(() => document.activeElement?.matches(".prompt-annotations-toggle"))
        expect(await toggle.evaluate((element) => element === document.activeElement)).toBe(true)
        expect(await toggle.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid")
        expect(await list.isVisible()).toBe(false)
        await toggle.press("Space")
        expect(await list.textContent()).toContain("Keep this saved note")
        await page.screenshot({ path: path.join(output, `${theme}-pending.png`) })
        await toggle.press("Space")

        await select(page)
        await toolbar.getByRole("button", { name: "Explain Briefly", exact: true }).click()
        const explanation = page.locator(".response-lens-popover")
        await explanation.locator(".response-lens-result").waitFor()
        await readable(explanation.locator(".response-lens-result"))
        for (const button of await explanation.locator("button:visible").all()) {
          if (await button.isDisabled()) continue
          await readable(button)
          await button.hover()
          await readable(button)
          await button.focus()
          await readable(button)
        }
        await page.screenshot({ path: path.join(output, `${theme}-explanation.png`) })
        await page.setViewportSize({ width: 320, height: 640 })
        await page.waitForFunction(
          () => {
            const rect = document.querySelector(".response-lens-popover")!.getBoundingClientRect()
            return rect.top >= 0 && rect.bottom <= window.innerHeight
          },
          undefined,
          { timeout: 5000 },
        )
        expect(await explanation.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
        await page.screenshot({ path: path.join(output, `${theme}-narrow.png`) })
        expect(errors).toEqual([])
      } catch (error) {
        await page.screenshot({ path: path.join(output, `${theme}-failure.png`) })
        throw error
      } finally {
        await page.close()
      }
    },
    60_000,
  )
})
