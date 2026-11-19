import { expect, test } from "bun:test"
import { build } from "esbuild"
import path from "node:path"
import { chromium } from "playwright-core"
import { createSolidPlugin } from "../../script/solid-cache"
import { executable, launchTimeout } from "../fixtures/chromium"

test.skipIf(!executable)(
  "steering keeps expanded edit and write previews visible as their rows move into history",
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

      const editLine = page.locator('[data-row-key="edit"] [data-line]').filter({ hasText: "export const NAME" })
      const writeLine = page.locator('[data-row-key="write"] [data-line]').filter({ hasText: "Fixture content." })
      await editLine.waitFor()
      await writeLine.waitFor()
      // Waiting for a locator again after the click would miss the skipped frame. Sample in the browser task
      // that moves the rows and the first animation frame, before Playwright can retry a visibility assertion.
      const result = await page.getByRole("button", { name: "Steer" }).evaluate(async (button) => {
        if (!(button instanceof HTMLButtonElement)) throw new Error("Missing steer button")
        const card = (key: string) => {
          const host = document.querySelector(`[data-row-key="${key}"] diffs-container`)!
          return {
            host,
            slot: host.closest('[data-slot="transcript-row-slot"]')!,
            visible: () => host.checkVisibility({ contentVisibilityAuto: true }),
          }
        }
        const edit = card("edit")
        const write = card("write")
        const outside = document.querySelector('[data-outside="true"] [data-component="file"]')!
        if (!outside) throw new Error("Missing card outside the transcript")

        const before = edit.visible()
        const writeBefore = write.visible()
        button.click()
        const moved = edit.host.isConnected && !edit.slot.contains(edit.host)
        const writeMoved = write.host.isConnected && !write.slot.contains(write.host)
        const during = edit.visible()
        const writeDuring = write.visible()
        await new Promise(requestAnimationFrame)
        return {
          before,
          writeBefore,
          moved,
          writeMoved,
          during,
          writeDuring,
          firstFrame: edit.visible(),
          writeFirstFrame: write.visible(),
          outside: getComputedStyle(outside).contentVisibility,
        }
      })
      expect(result).toEqual({
        before: true,
        writeBefore: true,
        moved: true,
        writeMoved: true,
        during: true,
        writeDuring: true,
        firstFrame: true,
        writeFirstFrame: true,
        outside: "auto",
      })
      await editLine.waitFor()
      await writeLine.waitFor()
    } finally {
      await browser.close()
    }
  },
  launchTimeout + 20_000,
)
