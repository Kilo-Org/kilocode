import { test, expect, type Page } from "@playwright/test"
import { platform } from "node:os"

const IS_DARWIN = platform() === "darwin"

if (IS_DARWIN) {
  console.warn("Visual regression tests must be run on CI, skipping on local macOS.")
  test.skip()
}

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const STORY_ID = "settings--indexing-provider-blur-race"

type Saved = {
  provider?: string
  openai?: { apiKey?: string }
  gemini?: { apiKey?: string }
}

function storyUrl() {
  return `/iframe.html?id=${STORY_ID}&viewMode=story&globals=${GLOBALS}`
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

test("provider switch writes to selected provider bucket", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 720 })
  await page.goto(storyUrl(), { waitUntil: "load" })
  await disableAnimations(page)
  await page.waitForSelector("#storybook-root *", { state: "attached" })

  const saved = page.getByTestId("indexing-provider-save")

  const trigger = page.locator('[data-component="select"] [data-slot="select-select-trigger"]').first()
  await trigger.click()
  await page.locator('[data-slot="select-select-item-label"]', { hasText: "Gemini" }).click()

  await expect
    .poll(async () => {
      const text = ((await saved.textContent()) ?? "{}").trim()
      const cfg = JSON.parse(text) as Saved
      return cfg.provider
    })
    .toBe("gemini")

  const text = ((await saved.textContent()) ?? "{}").trim()
  const cfg = JSON.parse(text) as Saved

  expect(cfg.provider).toBe("gemini")
  expect(cfg.openai?.apiKey ?? "").toBe("")
  expect(cfg.gemini?.apiKey ?? "").toBe("")
})
