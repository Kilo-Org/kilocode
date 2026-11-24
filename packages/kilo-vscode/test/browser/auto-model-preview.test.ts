import type axe from "axe-core"
import { KiloAutoPreview } from "@kilocode/gateway-core"
import { expect, test } from "bun:test"
import { build } from "esbuild"
import fs from "node:fs/promises"
import path from "node:path"
import { chromium, type Page } from "playwright-core"
import { createSolidPlugin } from "../../script/solid-cache"
import { executable, launchTimeout } from "../fixtures/chromium"

declare global {
  interface Window {
    axe: typeof axe
  }
}

const WCAG_RULES = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]

async function assertAccessible(page: Page, selector: string) {
  await page.addScriptTag({ path: Bun.resolveSync("axe-core/axe.min.js", import.meta.dir) })
  const findings = await page.evaluate(
    async (options) => {
      const result = await window.axe.run(options.selector, { runOnly: { type: "tag", values: options.rules } })
      const format = (item: axe.Result) => {
        const nodes = item.nodes.map((node) => `  ${node.target.join(" ")}\n${node.failureSummary ?? ""}`)
        return `${item.id}: ${item.help}\n${nodes.join("\n")}`
      }
      return [
        ...result.violations.map(format),
        ...result.incomplete
          .filter((item) => item.id === "color-contrast")
          .map((item) => `Incomplete: ${format(item)}`),
      ]
    },
    { selector, rules: WCAG_RULES },
  )
  expect(findings, findings.join("\n")).toEqual([])
}

const PROMPT = "Refactor the authentication helper to handle expired tokens and add tests."
const SCREENSHOT_DIR = process.env.AUTO_MODEL_PREVIEW_SCREENSHOT_DIR
const BASELINE_DIR =
  process.env.AUTO_MODEL_PREVIEW_BASELINE_DIR ?? path.join(import.meta.dir, "__screenshots__/auto-model-preview")
const UPDATE_BASELINES = process.env.AUTO_MODEL_PREVIEW_UPDATE_BASELINES === "1"
const MAX_DIFF_RATIO = 0.005

async function comparePng(page: Page, actual: Buffer, expected: Buffer) {
  const actualUrl = `data:image/png;base64,${actual.toString("base64")}`
  const expectedUrl = `data:image/png;base64,${expected.toString("base64")}`
  return page.evaluate(
    async ({ aUrl, bUrl }) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error("Failed to decode PNG for visual comparison"))
          img.src = src
        })
      const [a, b] = await Promise.all([load(aUrl), load(bUrl)])
      if (a.width !== b.width || a.height !== b.height) {
        return { sameSize: false, diffRatio: 1, widthA: a.width, heightA: a.height, widthB: b.width, heightB: b.height }
      }
      const read = (img: HTMLImageElement) => {
        const canvas = document.createElement("canvas")
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext("2d")!
        ctx.drawImage(img, 0, 0)
        return ctx.getImageData(0, 0, img.width, img.height).data
      }
      const dataA = read(a)
      const dataB = read(b)
      let diff = 0
      const pixels = a.width * a.height
      for (let i = 0; i < dataA.length; i += 4) {
        const delta =
          Math.abs(dataA[i]! - dataB[i]!) +
          Math.abs(dataA[i + 1]! - dataB[i + 1]!) +
          Math.abs(dataA[i + 2]! - dataB[i + 2]!) +
          Math.abs(dataA[i + 3]! - dataB[i + 3]!)
        if (delta > 16) diff++
      }
      return { sameSize: true, diffRatio: diff / pixels, widthA: a.width, heightA: a.height, widthB: b.width, heightB: b.height }
    },
    { aUrl: actualUrl, bUrl: expectedUrl },
  )
}

async function captureAndVerify(page: Page, name: string) {
  const baselinePath = path.join(BASELINE_DIR, name)
  const hasBaseline = await fs
    .access(baselinePath)
    .then(() => true)
    .catch(() => false)
  if (!SCREENSHOT_DIR && !UPDATE_BASELINES && !hasBaseline) return

  const actual = await page.screenshot()
  if (SCREENSHOT_DIR) {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true })
    await fs.writeFile(path.join(SCREENSHOT_DIR, name), actual)
  }
  if (UPDATE_BASELINES) {
    await fs.mkdir(BASELINE_DIR, { recursive: true })
    await fs.writeFile(baselinePath, actual)
    return
  }
  if (!hasBaseline) return

  const expected = await fs.readFile(baselinePath)
  const diff = await comparePng(page, actual, expected)
  expect(
    diff.sameSize,
    `${name} dimensions changed (${diff.widthA}x${diff.heightA} vs baseline ${diff.widthB}x${diff.heightB})`,
  ).toBe(true)
  expect(
    diff.diffRatio,
    `${name} visual diff ${(diff.diffRatio * 100).toFixed(2)}% exceeded ${(MAX_DIFF_RATIO * 100).toFixed(2)}% threshold`,
  ).toBeLessThanOrEqual(MAX_DIFF_RATIO)
}

test.skipIf(!executable)(
  "Auto Model preview shows for explicit models after typing a prompt, renders all four outcomes, and stays accessible across dark and light themes",
  async () => {
    const root = path.resolve(import.meta.dir, "../..")
    const bundle = await build({
      entryPoints: [path.join(import.meta.dir, "auto-model-preview.tsx")],
      outfile: "auto-model-preview.js",
      bundle: true,
      minify: true,
      platform: "browser",
      loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".svg": "text" },
      plugins: [
        createSolidPlugin({ root }),
        {
          name: "webview-workers",
          setup(ctx) {
            ctx.onResolve({ filter: /pierre\/worker$/ }, () => ({
              path: path.join(root, "webview-ui/pierre-worker.ts"),
            }))
            ctx.onResolve({ filter: /markdown-shiki\.worker\.ts\?worker&url$/ }, () => ({
              path: "markdown",
              namespace: "url",
            }))
            ctx.onLoad({ filter: /.*/, namespace: "url" }, () => ({ contents: 'export default ""' }))
          },
        },
      ],
      write: false,
    })

    const browser = await chromium.launch({ executablePath: executable, timeout: launchTimeout })
    try {
      const mount = async (query = "", viewport = { width: 390, height: 780 }) => {
        const missing = new URLSearchParams(query.replace(/^\?/, "")).get("missing") === "1"
        const context = await browser.newContext({ viewport, deviceScaleFactor: 2 })
        const page = await context.newPage()
        page.setDefaultTimeout(5_000)
        const errors: string[] = []
        page.on("pageerror", (err) => errors.push(err.message))
        page.on("console", (msg) => {
          if (msg.type() === "error") errors.push(msg.text())
        })
        await page.route("http://webview.test/**", async (route) => {
          const url = new URL(route.request().url())
          if (url.pathname.startsWith("/icons/")) {
            const file = path.join(root, "assets/icons", path.basename(url.pathname))
            const svg = await fs.readFile(file, "utf8").catch(() => "")
            if (svg) return route.fulfill({ contentType: "image/svg+xml", body: svg })
          }
          if (url.pathname === "/api/rpc/kilocode.gateway/autoModel.preview") {
            const parsed = JSON.parse(route.request().postData() ?? "{}") as { input?: KiloAutoPreview.PreviewInput }
            const req = parsed.input ?? { prompt: "" }
            const result = KiloAutoPreview.preview(req)
            const output = missing
              ? {
                  ...result,
                  attributes: {
                    ...result.attributes,
                    reasoningComplexity: null,
                    toolsRequired: null,
                  },
                }
              : result
            return route.fulfill({ contentType: "application/json", body: JSON.stringify({ output }) })
          }
          if (url.pathname === "/" || url.pathname === "/index.html") {
            return route.fulfill({
              contentType: "text/html",
              body: `<!doctype html>
                <link rel="stylesheet" href="/auto-model-preview.css">
                <style>
                  html, body {
                    height: 100%;
                    margin: 0;
                    overflow: hidden;
                    background: var(--vscode-sideBar-background);
                    color: var(--vscode-foreground);
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                  }
                  .chat-panel-shell { display: flex; flex-direction: column; height: 100%; width: 100%; }
                </style>
                <script defer src="/auto-model-preview.js"></script>
                <body></body>`,
            })
          }
          const asset = bundle.outputFiles.find((file) => `/${path.basename(file.path)}` === url.pathname)
          if (asset) {
            const contentType = asset.path.endsWith(".css") ? "text/css" : "text/javascript"
            return route.fulfill({ contentType, body: asset.text })
          }
          return route.continue()
        })
        await page.goto(`http://webview.test/${query}`, { waitUntil: "load" })
        await page.locator("textarea.prompt-input").waitFor({ state: "visible" })
        // Wait for the model selector to resolve the fixture default model.
        try {
          await page.waitForFunction(() => {
            const text = document.querySelector(".prompt-input-hint")?.textContent ?? ""
            return text.includes("Claude Opus") || text.includes("Auto Efficient")
          })
        } catch (err) {
          const hint = await page.locator(".prompt-input-hint").textContent().catch(() => null)
          throw new Error(`Hint=${JSON.stringify(hint)} errors=${JSON.stringify(errors)}: ${String(err)}`)
        }
        return { context, page }
      }

      // 1. Explicit model + empty prompt: Preview model button is hidden.
      const dark = await mount("?theme=dark&model=explicit")
      try {
        const trigger = dark.page.locator('[data-action="auto-model-preview"]')
        const textarea = dark.page.locator("textarea.prompt-input")
        await expect(trigger.count()).resolves.toBe(0)
        await captureAndVerify(dark.page, "01-before-empty-prompt.png")

        // 2. Typing a prompt reveals the Preview model button in the bottom-right toolbar.
        await expect(dark.page.locator(".startup-error-banner").count()).resolves.toBe(0)
        await textarea.fill(PROMPT)
        await trigger.waitFor({ state: "visible" })
        // Let the toolbar's ResizeObserver settle the fold after the pinned Preview button mounts.
        await dark.page.waitForFunction(() => {
          const triggerRect = document.querySelector('[data-action="auto-model-preview"]')?.getBoundingClientRect()
          if (!triggerRect) return false
          const actions = [...document.querySelectorAll(".prompt-action:not([data-folded])")]
          return actions.every((node) => node.getBoundingClientRect().right <= triggerRect.left + 1)
        })
        await expect(trigger.textContent()).resolves.toContain("Preview model")
        await captureAndVerify(dark.page, "02-after-button-ready.png")

        // 3. Clicking Preview model opens the dock above the composer with all 4 outcomes.
        await trigger.click()
        const panel = dark.page.locator('[data-component="auto-model-preview"]')
        await panel.waitFor({ state: "visible" })
        await dark.page.locator(".auto-model-preview-task-title").waitFor({ state: "visible" })

        const panelText = (await panel.textContent()) ?? ""
        expect(panelText).toContain("Auto Model preview")
        expect(panelText).toContain("Code refactoring & tests")
        expect(panelText).toContain("Updating existing code and adding test coverage")
        expect(panelText).toContain("Additional attributes")
        expect(panelText).toContain("High · authentication")
        expect(panelText).toContain("Predicted selection · Auto Efficient")
        expect(panelText).toContain("Claude Sonnet")
        expect(panelText).toContain("Predicted")
        expect(panelText).toContain("~$0.04")
        expect(panelText).toContain("~$0.16")
        expect(panelText).toContain("Current")
        expect(panelText).toContain("Consider Auto Frontier")
        expect(panelText).toContain("Illustrative classification")

        // Verify geometry: panel sits strictly above the prompt composer without horizontal overflow.
        const geometry = await dark.page.evaluate(() => {
          const preview = document.querySelector('[data-component="auto-model-preview"]')?.getBoundingClientRect()
          const composer = document.querySelector(".prompt-input-container")?.getBoundingClientRect()
          const triggerBox = document.querySelector('[data-action="auto-model-preview"]')?.getBoundingClientRect()
          const sendBox = document
            .querySelector('.prompt-input-hint-pinned button[data-component="icon-button"]')
            ?.getBoundingClientRect()
          return {
            previewBottom: preview?.bottom ?? 0,
            composerTop: composer?.top ?? 0,
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            triggerRight: triggerBox?.right ?? 0,
            sendLeft: sendBox?.left ?? 0,
          }
        })
        expect(geometry.overflow).toBe(false)
        expect(geometry.previewBottom).toBeLessThanOrEqual(geometry.composerTop + 1)
        expect(geometry.triggerRight).toBeLessThanOrEqual(geometry.sendLeft + 1)

        await assertAccessible(dark.page, '[data-component="auto-model-preview"]')
        await captureAndVerify(dark.page, "03-after-preview-open-dark.png")

        // 4. Collapsing Additional attributes hides the attribute list and flips aria-expanded.
        const attrsToggle = dark.page.locator('[data-action="auto-model-preview-attributes"]')
        expect(await attrsToggle.getAttribute("aria-expanded")).toBe("true")
        await attrsToggle.click()
        expect(await attrsToggle.getAttribute("aria-expanded")).toBe("false")
        await expect(dark.page.locator(".auto-model-preview-attrs-list").count()).resolves.toBe(0)
        await captureAndVerify(dark.page, "04-after-preview-collapsed-dark.png")
        await attrsToggle.click()
        expect(await attrsToggle.getAttribute("aria-expanded")).toBe("true")

        // 5. Editing the prompt displays the stale hint; clicking Preview model refreshes.
        await textarea.fill("Explain how session inbox delivery works.")
        await dark.page.locator(".auto-model-preview-stale").waitFor({ state: "visible" })
        await trigger.click()
        await dark.page.waitForFunction(() =>
          document.querySelector(".auto-model-preview-task-title")?.textContent?.includes("Explanation & Q&A"),
        )

        // 6. Clearing the prompt closes the open preview automatically and hides the button.
        await textarea.fill("")
        await panel.waitFor({ state: "hidden" })
        await expect(trigger.count()).resolves.toBe(0)

        // 7. Re-typing, opening, and pressing Escape closes the preview cleanly.
        await textarea.fill(PROMPT)
        await trigger.waitFor({ state: "visible" })
        await trigger.click()
        await panel.waitFor({ state: "visible" })
        await dark.page.keyboard.press("Escape")
        await panel.waitFor({ state: "hidden" })
      } finally {
        await dark.context.close()
      }

      // 7. Auto model selected: Preview model button stays hidden even after typing a prompt.
      const auto = await mount("?theme=dark&model=auto")
      try {
        await auto.page.locator("textarea.prompt-input").fill(PROMPT)
        await expect(auto.page.locator('[data-action="auto-model-preview"]').count()).resolves.toBe(0)
        await captureAndVerify(auto.page, "05-auto-model-hidden.png")
      } finally {
        await auto.context.close()
      }

      // 8. Light Modern theme + missing attributes ("Not available.") + accessibility check.
      const light = await mount("?theme=light&model=explicit&missing=1")
      try {
        await light.page.locator("textarea.prompt-input").fill(PROMPT)
        const trigger = light.page.locator('[data-action="auto-model-preview"]')
        await trigger.waitFor({ state: "visible" })
        await trigger.click()
        const panel = light.page.locator('[data-component="auto-model-preview"]')
        await panel.waitFor({ state: "visible" })
        await light.page.locator(".auto-model-preview-task-title").waitFor({ state: "visible" })
        expect((await panel.textContent()) ?? "").toContain("Not available.")
        await assertAccessible(light.page, '[data-component="auto-model-preview"]')
        await captureAndVerify(light.page, "06-after-preview-open-light.png")
      } finally {
        await light.context.close()
      }
    } finally {
      await browser.close()
    }
  },
  60_000,
)
