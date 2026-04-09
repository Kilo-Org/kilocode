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

// Animation protection is layered:
//   1. playwright.config.ts `reducedMotion: "reduce"` — emulates the OS
//      prefers-reduced-motion media feature before the page loads, so the
//      module-level `prefersReducedMotion()` signal (use-reduced-motion.ts)
//      initialises to `true`. This disables all JS spring animations driven
//      by GrowBox, useSpring, useToolFade, useRowWipe, ShellRollingResults
//      and ContextToolRollingResults.
//   2. CSS injection below — zeroes out any remaining CSS animation/transition
//      durations (Kobalte collapsible, Tailwind transitions, etc.).
//   3. waitForSettled() — flushes two requestAnimationFrame ticks so that
//      SolidJS reactive effects triggered by onMount (e.g. the `mounted()`
//      signal one-tick delay in ShellRollingResults) have run and inline
//      styles have been updated before the screenshot is taken.
async function disableAnimations(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
      }
    `,
  })
}

// Flush two animation frames so all SolidJS reactive effects that were
// scheduled during mount (e.g. mounted() signal flips) have been processed
// and written to the DOM before we take a screenshot.
async function waitForSettled(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
}

// Wait for every <img> inside the story root to finish loading so screenshots
// never capture an intermediate state with missing / half-loaded images.
async function waitForImages(page: Page) {
  await page.evaluate(() => {
    const imgs = document.querySelectorAll<HTMLImageElement>("#storybook-root img")
    return Promise.all(
      Array.from(imgs).map(
        (img) =>
          img.complete ||
          new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true })
            img.addEventListener("error", () => resolve(), { once: true })
          }),
      ),
    )
  })
}

// Wait for all @font-face declarations to resolve so screenshots are never
// taken while fallback fonts (Arial / Courier New) are still active.
async function waitForFonts(page: Page) {
  await page.evaluate(() => document.fonts.ready)
}

// Wait for the DOM inside #storybook-root to be idle for `idle` ms (capped at
// `timeout` ms). This ensures Storybook play() functions and any deferred
// renders (setTimeout, deferredHighlight, etc.) have settled before the screenshot.
async function waitForStable(page: Page, timeout = 2000, idle = 200) {
  await page.evaluate(
    ({ t, i }: { t: number; i: number }) =>
      new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout>
        const root = document.getElementById("storybook-root")
        const done = () => {
          observer.disconnect()
          resolve()
        }
        const reset = () => {
          clearTimeout(timer)
          timer = setTimeout(done, i)
        }
        const observer = new MutationObserver(reset)
        if (root) observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true })
        timer = setTimeout(done, i)
        setTimeout(done, t)
      }),
    { t: timeout, i: idle },
  )
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
    await waitForImages(page)
    // Wait for @font-face declarations to resolve (font-display: swap can
    // defer swapping to the custom font, causing screenshot diffs).
    await waitForFonts(page)
    // Flush pending rAF ticks so SolidJS onMount effects (e.g. mounted()
    // signal) have updated inline styles before the screenshot is taken.
    await waitForSettled(page)
    // Wait for the DOM to stop mutating — ensures Storybook play() functions
    // and deferred renders (setTimeout, deferredHighlight) have settled.
    await waitForStable(page)

    // Screenshot just the story content, not the full 1280x720 canvas.
    // Use [component, variant] path so snapshots are grouped per component dir.
    const [component, variant] = story.id.split("--")
    const root = page.locator("#storybook-root")
    await expect(root).toHaveScreenshot([component, `${variant}.png`])
  })
}
