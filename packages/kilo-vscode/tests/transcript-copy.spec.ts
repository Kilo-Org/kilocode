import { expect, test } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const STORY_ID = "chat--message-list-layout-correction"

// VS Code 1.143+ refocuses the last focused webview element before a native
// Copy when focus is on the body. A mouse selection must move focus to the
// transcript, or VS Code refocuses the prompt and the selection collapses.
test("selecting transcript text moves focus to the transcript", async ({ page }) => {
  await page.goto(`/iframe.html?id=${STORY_ID}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
  const list = page.locator(".message-list")
  const text = list.locator('[data-slot="text-part-body"]').last()
  await expect(text).toBeVisible()

  const box = await text.boundingBox()
  if (!box) throw new Error("Transcript text has no layout box")
  const y = box.y + Math.min(box.height / 2, 8)
  await page.mouse.move(box.x + 1, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 1, y, { steps: 10 })
  await page.mouse.up()

  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).not.toBe("")
  await expect(list).toBeFocused()
})
