import { expect, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

export async function open(page: Page) {
  await page.goto(`/iframe.html?id=prompt-input--default-420&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
  const input = page.locator("textarea.prompt-input")
  await expect(input).toBeVisible()
  await page.evaluate(() => window.postMessage({ type: "connectionState", state: "connected" }, window.origin))
  await expect(input).toBeEnabled()
  return input
}
