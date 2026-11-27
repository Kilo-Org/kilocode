import { expect, test } from "bun:test"
import { build } from "esbuild"
import path from "node:path"
import { chromium, type Locator } from "playwright-core"
import { createSolidPlugin } from "../../script/solid-cache"
import { executable, launchTimeout } from "../fixtures/chromium"

test.skipIf(!executable)(
  "the Swarm dock, board and inspector use the transcript's agent identities",
  async () => {
    const root = path.resolve(import.meta.dir, "../..")
    const bundle = await build({
      entryPoints: [path.join(import.meta.dir, "swarm-avatar-colors.tsx")],
      outfile: "swarm-avatar-colors.js",
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
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
      page.setDefaultTimeout(15_000)
      await page.route("http://webview.test/", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!doctype html>
            <link rel="stylesheet" href="swarm-avatar-colors.css">
            <style>
              :root { --vscode-charts-orange: #d18616; --vscode-charts-green: #388a34; }
              html, body { height: 100%; margin: 0; overflow: hidden; }
              body { display: flex; }
              .am-subagent-panel { width: 220px; }
            </style>
            <script defer src="swarm-avatar-colors.js"></script><body></body>`,
        }),
      )
      for (const file of bundle.outputFiles) {
        const contentType = file.path.endsWith(".css") ? "text/css" : "text/javascript"
        await page.route(`http://webview.test/${path.basename(file.path)}`, (route) =>
          route.fulfill({ contentType, body: file.text }),
        )
      }
      await page.goto("http://webview.test/", { waitUntil: "commit" })

      const transcript = page.locator('[data-slot="task-agent-avatar"] [data-component="agent-avatar"]')
      const stack = page.locator('[data-component="agent-stack"]:visible')
      const avatars = stack.locator('[data-component="agent-avatar"]')
      const appearance = (avatar: Locator) =>
        avatar.evaluate((element) => ({
          color: getComputedStyle(element).color,
          dots: [...element.querySelectorAll("circle[data-lit]")].map((dot) => [
            dot.getAttribute("cx"),
            dot.getAttribute("cy"),
          ]),
        }))
      // The board portals mount before the avatar's color rule applies, so wait for the
      // computed color instead of racing the first paint on a loaded runner.
      const settled = async (avatar: Locator) => {
        await avatar.waitFor({ state: "visible" })
        const element = await avatar.elementHandle()
        if (!element) throw new Error("avatar is not attached")
        await page.waitForFunction((node) => getComputedStyle(node as Element).color !== "", element)
        await element.dispose()
        return appearance(avatar)
      }

      const first = await settled(transcript.nth(0))
      const second = await settled(transcript.nth(1))
      expect(second.color).not.toBe(first.color)
      expect(await settled(avatars.nth(0))).toEqual(first)
      expect(await settled(avatars.nth(1))).toEqual(second)
      const participants = page.locator('[data-component="board-participant-stack"] [data-component="agent-avatar"]')
      expect(await settled(participants.nth(0))).toEqual(first)
      expect(await settled(participants.nth(1))).toEqual(second)

      const inspector = page.locator(".am-subagent-panel")
      const tabAvatar = (name: string) =>
        inspector.getByRole("tab", { name }).locator('[data-component="agent-avatar"]')
      expect(await settled(tabAvatar("Agent 1"))).toEqual(first)
      expect(await settled(tabAvatar("Agent 2"))).toEqual(second)

      await stack.click()
      const row = page.locator('[data-slot="agent-panel-main"]').filter({ hasText: "Agent 2" })
      expect(await settled(row.locator('[data-component="agent-avatar"]'))).toEqual(second)
      await stack.click()

      await page.locator('[data-component="board-trigger"]:visible').click()
      const boardAvatar = (container: Locator, name: string) =>
        container.getByRole("button", { name, exact: true }).locator('[data-component="agent-avatar"]')
      const preview = page.locator('[data-slot="board-panel-list"]')
      expect(await settled(boardAvatar(preview, "Agent 1"))).toEqual(first)
      expect(await settled(boardAvatar(preview, "Agent 2"))).toEqual(second)

      await page.getByRole("button", { name: "Open board", exact: true }).press("Enter")
      const full = page.locator(".task-board-list")
      expect(await settled(boardAvatar(full, "Agent 1"))).toEqual(first)
      expect(await settled(boardAvatar(full, "Agent 2"))).toEqual(second)
    } finally {
      await browser.close()
    }
  },
  40_000,
)
