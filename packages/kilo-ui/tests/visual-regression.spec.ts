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

const STORYBOOK_URL = "http://localhost:6006"

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

// Stories to skip from visual regression:
// - Font/Favicon: inject into <head>, no visible content in #storybook-root
// - Typewriter: uses JS setTimeout + Math.random(), inherently non-deterministic
const SKIP = new Set([
  "components-font--default",
  "components-font--nerd-fonts",
  "components-favicon--default",
  "components-typewriter--default",
  "components-typewriter--short",
  "components-typewriter--long",
  "components-typewriter--as-heading",
  "components-typewriter--with-class",
])

// Generate one test() per story so Playwright's scheduler can distribute
// them freely across workers — no manual sharding needed.
// Skip fetching stories on macOS since test.skip() above already marks the file skipped.
const stories = IS_DARWIN ? [] : (await fetchStories()).filter((s) => !SKIP.has(s.id))

for (const story of stories) {
  test(`${story.title} / ${story.name}`, async ({ page }) => {
    await page.goto(`/iframe.html?id=${story.id}&viewMode=story&globals=colorScheme:dark;theme:kilo`, {
      waitUntil: "load",
    })
    await disableAnimations(page)
    // Wait for Kobalte/SolidJS to finish hydrating interactive components
    await page.waitForSelector("#storybook-root *", { state: "attached" })

    // Screenshot just the story content, not the full 1280x720 canvas.
    // Use [component, variant] path so snapshots are grouped per component dir.
    const [component, variant] = story.id.split("--")
    const root = page.locator("#storybook-root")
    await expect(root).toHaveScreenshot([component, `${variant}.png`])
  })
}
