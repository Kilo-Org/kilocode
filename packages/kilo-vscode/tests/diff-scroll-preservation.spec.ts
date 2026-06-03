import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const STORY_ID = "agentmanager--full-screen-diff-agent-edit-scroll"

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

async function openStory(page: Page) {
  await page.setViewportSize({ width: 800, height: 720 })
  await page.addInitScript(() => {
    const win = window as Window & { nativeIntersectionObserver?: typeof IntersectionObserver }
    win.nativeIntersectionObserver = window.IntersectionObserver
    Object.defineProperty(window, "IntersectionObserver", { configurable: true, value: undefined, writable: true })
  })
  await page.goto(storyUrl(), { waitUntil: "load" })
  await disableAnimations(page)
  await page.waitForSelector("#storybook-root *", { state: "attached" })

  const first = page.locator('[data-file-path="src/agent-edit.ts"] [data-component="diff"]')
  await expect.poll(async () => first.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(3_000)
  return first
}

test("preserves diff scroll position while an agent edit refreshes a file", async ({ page }) => {
  const first = await openStory(page)
  const scroller = page.locator(".am-review-diff")
  const target = page.locator('[data-file-path="src/target.ts"]')

  // The initial tall diff rendered eagerly. Restore the real observer before
  // moving it offscreen so an unfixed row remount takes the deferred path.
  await page.evaluate(() => {
    const win = window as Window & { nativeIntersectionObserver?: typeof IntersectionObserver }
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: win.nativeIntersectionObserver,
      writable: true,
    })
  })

  await scroller.evaluate((el) => {
    const target = el.querySelector('[data-file-path="src/target.ts"]')
    if (!(target instanceof HTMLElement)) throw new Error("Target diff row not found")
    el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - 24
  })

  const before = await scroller.evaluate((el) => el.scrollTop)
  const top = await target.evaluate((el) => el.getBoundingClientRect().top)
  expect(before).toBeGreaterThan(3_000)

  await page.getByRole("button", { name: "Apply agent edit" }).click()
  await expect(page.getByTestId("agent-edit-version")).toHaveText("after")
  await expect.poll(async () => first.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(3_000)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  const after = await scroller.evaluate((el) => el.scrollTop)
  const next = await target.evaluate((el) => el.getBoundingClientRect().top)
  expect(after).toBeCloseTo(before, 0)
  expect(next).toBeCloseTo(top, 0)
})

test("remounts diff rows when the review context changes", async ({ page }) => {
  const first = await openStory(page)
  await page.evaluate(() => {
    class IdleObserver {
      readonly root = null
      readonly rootMargin = "0px"
      readonly thresholds = []

      disconnect() {}
      observe() {}
      takeRecords() {
        return []
      }
      unobserve() {}
    }

    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: IdleObserver,
      writable: true,
    })
  })

  await page.getByRole("button", { name: "Switch review context" }).click()
  await expect(page.getByTestId("review-context")).toHaveText("changed-context")
  await expect.poll(async () => first.evaluate((el) => el.getBoundingClientRect().height)).toBe(1_200)
})
