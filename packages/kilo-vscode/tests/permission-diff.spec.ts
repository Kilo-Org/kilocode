import { expect, test } from "@playwright/test"

const STORY_ID = "composite-webview--permission-dock-edit"
const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

test("edit approval diff shows line numbers in compact viewer", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 720 })
  await page.goto(`/iframe.html?id=${STORY_ID}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })

  const number = page.locator('[data-slot="permission-diff-content"] [data-column-number]').first()
  await expect(number).toBeVisible()
})
