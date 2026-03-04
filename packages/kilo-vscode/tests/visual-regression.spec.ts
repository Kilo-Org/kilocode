import { test, expect, type Page } from "@playwright/test"
import { platform } from "node:os"

const IS_DARWIN = platform() === "darwin"

// Screenshot baselines are captured on Linux CI — font rendering and anti-aliasing
// differ on macOS, which causes false-positive diffs.  Skip the entire suite there.
if (IS_DARWIN) {
  console.warn("Visual regression tests must be run on CI, skipping on local macOS.")
  test.skip()
}

type Story = {
  id: string
  title: string
  name: string
}

type StoriesIndex = {
  stories?: Record<string, Story>
  entries?: Record<string, Story>
}

const STORYBOOK_URL = "http://localhost:6007"

// Fetched once per worker process — cheap HTTP call to the already-running Storybook
async function fetchStories(): Promise<Story[]> {
  const res = await fetch(`${STORYBOOK_URL}/index.json`).catch(() => fetch(`${STORYBOOK_URL}/stories.json`))
  if (!res.ok) throw new Error(`Storybook index fetch failed: ${res.status} ${res.statusText}`)
  const data = (await res.json()) as StoriesIndex
  const map = data.entries ?? data.stories ?? {}
  return Object.values(map).filter((s) => s.id && !s.id.endsWith("--docs"))
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

// Stories to skip from visual regression (add IDs here if needed)
const SKIP = new Set<string>([])

// Use test.describe + beforeAll to avoid top-level await which breaks
// on Node.js versions with strict ESM/CJS boundaries.
test.describe("Visual Regression", () => {
  let stories: Story[] = []

  test.beforeAll(async () => {
    if (IS_DARWIN) return
    stories = (await fetchStories()).filter((s) => !SKIP.has(s.id))
  })

  test("all stories", async ({ page }) => {
    if (IS_DARWIN) return
    for (const story of stories) {
      // Narrow stories (IDs ending in "-200") use a 200px viewport
      // The "-200" suffix comes from the export name convention (e.g. Default200, WithThinking200)
      const narrow = story.id.endsWith("-200")
      await page.setViewportSize({ width: narrow ? 200 : 420, height: 720 })

      // Use kilo-vscode theme by default (matched to the preview initialGlobals)
      await page.goto(
        `/iframe.html?id=${story.id}&viewMode=story&globals=colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern`,
        { waitUntil: "load" },
      )
      await disableAnimations(page)
      await page.waitForSelector("#storybook-root *", { state: "attached" })

      const [component, variant] = story.id.split("--")
      const root = page.locator("#storybook-root")
      await expect(root).toHaveScreenshot([component!, `${variant}.png`])
    }
  })
})
