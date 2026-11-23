import { expect, test } from "@playwright/test"
import { build } from "esbuild"
import { fileURLToPath } from "node:url"

const bundle = await build({
  stdin: {
    contents: `
      export { toSessionDiffFile } from "./src/diff/sources/session"
      export { createPRDiffs } from "./webview-ui/diff-viewer/pr-diff"
    `,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
})
const adapters: {
  toSessionDiffFile: typeof import("../src/diff/sources/session").toSessionDiffFile
  createPRDiffs: typeof import("../webview-ui/diff-viewer/pr-diff").createPRDiffs
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.contents).toString("base64")}`)

const globals = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

for (const consumer of ["session", "pr"] as const) {
  for (const layout of ["full", "inline"] as const) {
    test(`${consumer} ${layout} Markdown excerpts keep source-coordinate comments and drafts`, async ({ page }) => {
      await page.setViewportSize({ width: 1000, height: 800 })
      const story = `agentmanager--markdown-excerpt-${layout === "inline" ? "inline-" : ""}review`
      await page.goto(`/iframe.html?id=${story}&viewMode=story&globals=${globals}`, { waitUntil: "load" })
      await expect(page.getByRole("button", { name: "Refresh diff" })).toBeVisible()

      const file = `${consumer}.md`
      const patch = [
        `--- a/${file}`,
        `+++ b/${file}`,
        "@@ -47,7 +77,7 @@",
        " Intro",
        " ",
        " ",
        "-# Old heading",
        "+# New heading",
        " ",
        " Details",
        " End",
        "",
      ].join("\n")
      // Exercise the production adapters, then give their output to the actual review UI.
      const diffs =
        consumer === "session"
          ? [adapters.toSessionDiffFile({ file, patch, additions: 1, deletions: 1, status: "modified" })]
          : adapters.createPRDiffs({
              id: "markdown-review",
              head: "a".repeat(40),
              files: [{ path: file, status: "modified", patch }],
            })
      await page.evaluate(
        ({ story, diffs }) => {
          window.postMessage(
            {
              key: "storybook-channel",
              event: { type: "updateStoryArgs", args: [{ storyId: story, updatedArgs: { diffs } }] },
            },
            window.location.origin,
          )
        },
        { story, diffs },
      )
      const row = page.locator(`[data-file-path="${file}"]`)
      await expect(row.locator('[data-line="80"]').last()).toBeVisible()
      // Rendering starts enabled in the story, as with a persisted Markdown preference.
      await expect(row.getByRole("button", { name: /Render Markdown|Show raw Markdown/ })).toHaveCount(0)
      await expect(row.locator(".am-markdown-diff, .am-markdown-comment-button")).toHaveCount(0)
      await expect(row.locator('[data-line="4"]')).toHaveCount(0)

      for (const [index, side] of ["additions", "deletions"].entries()) {
        const line = side === "additions" ? 80 : 50
        const body = `Keep ${consumer} ${side} heading`
        await row.locator(`[data-line="${line}"]`).last().hover()
        await row.locator("[data-utility-button]").last().click()
        const draft = row.locator(".am-annotation-draft textarea")
        await draft.fill(body)
        await page.getByRole("button", { name: "Refresh diff" }).click()
        await expect(page.getByTestId("markdown-review-version")).toHaveText(String(index * 2 + 1))
        await expect(draft).toHaveValue(body)
        await expect(row.locator(`[slot="annotation-${side}-${line}"] textarea`)).toHaveValue(body)

        await row.locator('[data-action="save"]').click()
        await expect(draft).toHaveCount(0)
        await expect(row.getByText(body, { exact: true })).toBeVisible()
        await page.getByRole("button", { name: "Refresh diff" }).click()
        await expect(page.getByTestId("markdown-review-version")).toHaveText(String(index * 2 + 2))
        await expect(row.locator(`[slot="annotation-${side}-${line}"]`)).toContainText(body)
      }
    })
  }
}

test("full-file Markdown still renders and retains rendered comments across refresh", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.goto(`/iframe.html?id=agentmanager--markdown-full-file-review&viewMode=story&globals=${globals}`, {
    waitUntil: "load",
  })
  const row = page.locator('[data-file-path="notes.md"]')
  await expect(row.getByRole("heading", { name: "New heading" })).toBeVisible()
  await row.getByRole("button", { name: "Show raw Markdown", exact: true }).click()
  await expect(row.locator(".am-markdown-diff")).toHaveCount(0)
  await row.getByRole("button", { name: "Render Markdown", exact: true }).click()
  await expect(row.getByRole("heading", { name: "New heading" })).toBeVisible()
  await row.getByRole("button", { name: "Comment on line 4", exact: true }).last().click()
  const draft = row.locator(".am-annotation-draft textarea")
  await draft.fill("Keep full-file rendering")
  await page.getByRole("button", { name: "Refresh diff" }).click()
  await expect(page.getByTestId("markdown-review-version")).toHaveText("1")
  await expect(draft).toHaveValue("Keep full-file rendering")
  await row.locator('[data-action="save"]').click()
  await expect(draft).toHaveCount(0)
  await expect(row.getByText("Keep full-file rendering", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Refresh diff" }).click()
  await expect(page.getByTestId("markdown-review-version")).toHaveText("2")
  await expect(row.getByText("Keep full-file rendering", { exact: true })).toBeVisible()
})
