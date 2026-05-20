import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

function storyUrl(story: string) {
  return `/iframe.html?id=${story}&viewMode=story&globals=${GLOBALS}`
}

async function disableAnimations(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  })
}

test("permission actions stay reachable with many file diffs", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 720 })
  await page.goto(storyUrl("composite-webview--permission-dock-many-files"), { waitUntil: "load" })
  await disableAnimations(page)
  await page.waitForSelector("#storybook-root *", { state: "attached" })

  const root = page.locator("#storybook-root")
  const diffs = page.locator('[data-slot="permission-diffs"]')
  const actions = page.locator('[data-slot="permission-actions"]')

  await expect(diffs).toBeVisible()
  await expect(actions).toBeVisible()

  const rootBox = await root.boundingBox()
  const actionsBox = await actions.boundingBox()

  expect(rootBox).not.toBeNull()
  expect(actionsBox).not.toBeNull()
  expect(actionsBox!.y + actionsBox!.height).toBeLessThanOrEqual(rootBox!.y + rootBox!.height)

  await diffs.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })

  await expect(actions).toBeVisible()
})
