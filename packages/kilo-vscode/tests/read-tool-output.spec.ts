import { expect, test } from "@playwright/test"

const STORY_ID = "composite-webview--read-offset-result"
const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

test("completed Read exposes the exact high-offset output", async ({ page }) => {
  await page.goto(`/iframe.html?id=${STORY_ID}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })

  const root = page.locator("#storybook-root")
  const trigger = root.locator('[data-component="tool-trigger"]')
  const output = root.locator('[data-component="tool-output"]')

  await expect(trigger).toContainText("offset=11091")
  await expect(trigger.locator('[data-slot="collapsible-arrow"]')).toBeVisible()
  await expect(output).toBeHidden()

  await trigger.click()

  await expect(output).toBeVisible()
  await expect(output).toContainText("<path>/project/riemann hypothesis.lean</path>")
  await expect(output).toContainText("11091: theorem challenge_two")
  await expect(output).toContainText("Showing lines 11091-11093")
  await expect(output.locator("path")).toHaveCount(0)

  const pre = output.locator('[data-slot="read-tool-output"]')
  await pre.evaluate((node) => {
    node.textContent = `11092: ${"x".repeat(2000)}`
  })

  await expect(pre).toHaveCSS("margin-top", "0px")
  await expect(pre).toHaveCSS("margin-bottom", "0px")
  await expect(pre).toHaveCSS("white-space", "pre-wrap")
  expect(await pre.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
})
