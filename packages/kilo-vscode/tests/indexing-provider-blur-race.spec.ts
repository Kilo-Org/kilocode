import { test, expect, type Page } from "@playwright/test"
import { platform } from "node:os"

const IS_DARWIN = platform() === "darwin"

if (IS_DARWIN) {
  console.warn("Visual regression tests must be run on CI, skipping on local macOS.")
  test.skip()
}

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const STORY_ID = "settings--indexing-provider-blur-race"
const KILO_STORY_ID = "settings--indexing-kilo-model-preset"
const KILO_LOADING_STORY_ID = "settings--indexing-kilo-catalog-loading"

type Saved = {
  provider?: string
  model?: string | null
  dimension?: number | null
  openai?: { apiKey?: string }
  gemini?: { apiKey?: string }
}

function storyUrl(id = STORY_ID) {
  return `/iframe.html?id=${id}&viewMode=story&globals=${GLOBALS}`
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

function field(page: Page, title: string) {
  return page.locator('[data-slot="settings-row"]', { hasText: title }).locator("input")
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
  expect(cfg.model).toBeNull()
  expect(cfg.dimension).toBeNull()
  expect(cfg.openai?.apiKey ?? "").toBe("")
  expect(cfg.gemini?.apiKey ?? "").toBe("")

  const model = field(page, "Embedding model").first()
  await expect(model).toHaveValue("")
  await expect(model).toHaveAttribute("placeholder", "Enter model ID")
})

test("Kilo exposes only supported embedding model presets", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 720 })
  await page.goto(storyUrl(KILO_STORY_ID), { waitUntil: "load" })
  await disableAnimations(page)
  await page.waitForSelector("#storybook-root *", { state: "attached" })

  await expect(page.getByText("Kilo model preset", { exact: true })).toBeVisible()
  await expect(page.getByText("Embedding model", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Vector dimension", { exact: true })).toBeVisible()

  const preset = page.locator('[data-component="select"] [data-slot="select-select-trigger"]').nth(1)
  await expect(preset).toContainText("Provider Model")

  const dimension = field(page, "Vector dimension").first()
  await expect(dimension).toHaveValue("")

  await preset.click()
  await page.locator('[data-slot="select-select-item-label"]', { hasText: "Provider Compact" }).click()
  await expect(preset).toContainText("Provider Compact")
})

test("enabling Kilo before its catalog loads does not store an empty model", async ({ page }) => {
  const saved = page.getByTestId("indexing-kilo-loading-save")
  const cfg = async () => JSON.parse(((await saved.textContent()) ?? "{}").trim()) as Saved
  const verify = async () => {
    await expect.poll(async () => (await cfg()).provider).toBe("kilo")
    expect((await cfg()).model).toBeNull()
    expect((await cfg()).dimension).toBeNull()
  }

  await page.setViewportSize({ width: 420, height: 720 })
  await page.goto(storyUrl(KILO_LOADING_STORY_ID), { waitUntil: "load" })
  await disableAnimations(page)
  await page.waitForSelector("#storybook-root *", { state: "attached" })
  await page.locator('[data-component="switch"] [data-slot="switch-control"]').nth(1).click()
  await verify()

  await page.goto(storyUrl(KILO_LOADING_STORY_ID), { waitUntil: "load" })
  await page.waitForSelector("#storybook-root *", { state: "attached" })
  await page.locator('[data-component="switch"] [data-slot="switch-control"]').first().click()
  await verify()
})
