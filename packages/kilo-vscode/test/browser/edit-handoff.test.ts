import { expect, test } from "bun:test"
import { build } from "esbuild"
import path from "node:path"
import { chromium } from "playwright-core"
import { createSolidPlugin } from "../../script/solid-cache"
import { executable, launchTimeout } from "../fixtures/chromium"

test.skipIf(!executable)(
  "steering keeps an expanded edit visible as its row moves into history",
  async () => {
    const root = path.resolve(import.meta.dir, "../..")
    const bundle = await build({
      entryPoints: [path.join(import.meta.dir, "edit-handoff.tsx")],
      outfile: "edit-handoff.js",
      bundle: true,
      minify: true,
      platform: "browser",
      loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".svg": "text" },
      plugins: [
        createSolidPlugin({ root }),
        {
          name: "webview-workers",
          setup(ctx) {
            // Exercise the production loader's main-thread fallback: no host injects a worker URI in this page.
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
      const page = await browser.newPage({ viewport: { width: 480, height: 700 } })
      await page.route("http://webview.test/", (route) =>
        route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }),
      )
      await page.goto("http://webview.test/")
      await page.addStyleTag({ content: bundle.outputFiles.find((f) => f.path.endsWith(".css"))!.text })
      await page.addScriptTag({ content: bundle.outputFiles.find((f) => f.path.endsWith(".js"))!.text })

      const line = page.locator('[data-component="edit-content"] [data-line]').filter({ hasText: "export const NAME" })
      await line.waitFor()
      // Waiting for the locator again after the click would miss the skipped frame. Sample in the browser task
      // that moves the row and the first animation frame, before Playwright can retry a visibility assertion.
      const result = await page.getByRole("button", { name: "Steer" }).evaluate(async (button) => {
        if (!(button instanceof HTMLButtonElement)) throw new Error("Missing steer button")
        const host = document.querySelector("diffs-container")!
        const slot = host.closest('[data-slot="transcript-row-slot"]')!
        const visible = () => host.checkVisibility({ contentVisibilityAuto: true })
        const before = visible()
        button.click()
        const moved = host.isConnected && !slot.contains(host)
        const during = visible()
        await new Promise(requestAnimationFrame)
        return { before, moved, during, firstFrame: visible() }
      })
      expect(result).toEqual({ before: true, moved: true, during: true, firstFrame: true })
      await line.waitFor()
    } finally {
      await browser.close()
    }
  },
  launchTimeout + 20_000,
)
