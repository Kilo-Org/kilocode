import type axe from "axe-core"
import { expect, test } from "bun:test"
import { build } from "esbuild"
import path from "node:path"
import { chromium } from "playwright-core"
import { createSolidPlugin } from "../../script/solid-cache"

declare global {
  interface Window {
    axe: typeof axe
  }
}

const label = "Search worktrees and sessions"
const dialogSelector = ".am-sidebar-search-popover"
const rules = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]

test("Agent Manager search meets automated WCAG checks and supports keyboard selection and dismissal", async () => {
  const bundle = await build({
    entryPoints: [path.join(import.meta.dir, "sidebar-search.tsx")],
    outfile: "sidebar-search.js",
    bundle: true,
    platform: "browser",
    loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
    plugins: [createSolidPlugin({ root: path.resolve(import.meta.dir, "../..") })],
    write: false,
  })
  const script = bundle.outputFiles.find((file) => file.path.endsWith(".js"))
  const styles = bundle.outputFiles.find((file) => file.path.endsWith(".css"))
  if (!script || !styles) throw new Error("Expected both a webview script and a stylesheet")

  const browser = await chromium.launch({ timeout: 10_000 })
  try {
    const page = await browser.newPage({ colorScheme: "dark", reducedMotion: "reduce" })
    page.setDefaultTimeout(5_000)
    // Use an isolated origin for the webview theme's storage without starting an HTTP server.
    await page.route("http://webview.test/", (route) =>
      route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><title>Agent Manager</title>' }),
    )
    await page.goto("http://webview.test/")
    await page.addStyleTag({ content: styles.text })
    await page.addScriptTag({ content: script.text })

    const trigger = page.getByRole("button", { name: label, exact: true })
    const dialog = page.getByRole("dialog", { name: label, exact: true }).and(page.locator(dialogSelector))
    const input = dialog.getByPlaceholder(label, { exact: true })
    const prompt = page.getByRole("textbox", { name: "Chat input" })
    const focused = page.locator(":focus")

    await trigger.waitFor()
    await page.keyboard.press("Tab")
    await trigger.and(focused).waitFor()
    await page.keyboard.press("Enter")
    await input.and(focused).waitFor()
    await dialog.getByText("Render images in diff viewer", { exact: true }).waitFor()

    // Scan the portal, not just the mount node. The visible result above prevents a scan of an empty shell.
    await page.addScriptTag({ path: Bun.resolveSync("axe-core/axe.min.js", import.meta.dir) })
    // The opening animation fades the whole dialog in. Measure contrast at its settled opacity.
    await dialog.evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished))
    })
    const findings = await page.evaluate(
      async (options) => {
        const result = await window.axe.run(options.selector, { runOnly: { type: "tag", values: options.rules } })
        const format = (item: axe.Result) => {
          const nodes = item.nodes.map((node) => `  ${node.target.join(" ")}\n${node.failureSummary ?? ""}`)
          return `${item.id}: ${item.help}\n${nodes.join("\n")}`
        }
        return [
          ...result.violations.map(format),
          // An unresolved background must not silently bypass the contrast check.
          ...result.incomplete
            .filter((item) => item.id === "color-contrast")
            .map((item) => `Incomplete: ${format(item)}`),
        ]
      },
      { selector: dialogSelector, rules },
    )
    expect(findings, findings.join("\n")).toEqual([])

    await input.fill("rndr img")
    await dialog.getByText("Render images in diff viewer", { exact: true }).waitFor()
    await dialog.locator('[data-slot="sidebar-search-result"][data-kind="local"]').waitFor({ state: "hidden" })
    await page.keyboard.press("Enter")
    await dialog.waitFor({ state: "hidden" })
    expect(await page.getByTestId("selection").textContent()).toBe("Render images in diff viewer")
    await prompt.and(focused).waitFor()

    await page.keyboard.press("Shift+Tab")
    await trigger.and(focused).waitFor()
    await page.keyboard.press("Enter")
    await input.and(focused).waitFor()
    await input.fill("no such session")
    await dialog.locator('[data-slot="list-empty-state"]').waitFor()
    await page.keyboard.press("Escape")
    await dialog.waitFor({ state: "hidden" })
    await prompt.and(focused).waitFor()
    expect(await page.getByTestId("selection").textContent()).toBe("Render images in diff viewer")
  } finally {
    await browser.close()
  }
}, 30_000)
