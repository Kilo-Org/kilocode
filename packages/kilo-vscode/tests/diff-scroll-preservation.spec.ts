import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const STORY_ID = "agentmanager--full-screen-diff-agent-edit-scroll"
const INLINE_STORY_ID = "agentmanager--diff-panel-scroll-up"

function storyUrl() {
  return `/iframe.html?id=${STORY_ID}&viewMode=story&globals=${GLOBALS}`
}

function inlineStoryUrl() {
  return `/iframe.html?id=${INLINE_STORY_ID}&viewMode=story&globals=${GLOBALS}`
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

async function showTarget(page: Page) {
  const target = page.locator('[data-file-path="src/target.ts"]')
  await page.locator(".am-review-diff").evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(target).toBeAttached()
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return target
}

async function alignTarget(page: Page) {
  await page.locator(".am-review-diff").evaluate((el) => {
    const target = el.querySelector('[data-file-path="src/target.ts"]')
    if (!(target instanceof HTMLElement)) throw new Error("Target diff row not found")
    el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - 24
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

test("preserves diff scroll position while an agent edit refreshes a file", async ({ page }) => {
  const first = await openStory(page)
  const scroller = page.locator(".am-review-diff")

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

  const target = await showTarget(page)

  await alignTarget(page)
  await alignTarget(page)

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

test("preserves scroll while adding and editing a review comment", async ({ page }) => {
  await openStory(page)
  const scroller = page.locator(".am-review-diff")
  const target = await showTarget(page)

  await alignTarget(page)
  await alignTarget(page)

  const line = target.locator('[data-line="1"]').last()
  await line.hover()
  await target.locator("[data-utility-button]").last().click()
  await expect(target.locator(".am-annotation-textarea")).toBeVisible()
  await target.locator(".am-annotation-textarea").fill("Keep this stable")
  const top = await target.evaluate((el) => el.getBoundingClientRect().top)
  const before = await scroller.evaluate((el) => el.scrollTop)

  await page.getByRole("button", { name: "Apply agent edit" }).click()
  await expect(page.getByTestId("agent-edit-version")).toHaveText("after")
  await expect(target.locator(".am-annotation-textarea")).toHaveValue("Keep this stable")
  await expect.poll(async () => scroller.evaluate((el) => el.scrollTop)).toBeCloseTo(before, 0)
  await expect.poll(async () => target.evaluate((el) => el.getBoundingClientRect().top)).toBeCloseTo(top, 0)

  await target.getByRole("button", { name: "Comment" }).click()
  await expect(target.getByText("Keep this stable")).toBeVisible()
  const saved = await scroller.evaluate((el) => el.scrollTop)

  await target.getByTitle("Edit").click()
  await target.locator(".am-annotation-textarea").fill("Still stable")
  await target.getByRole("button", { name: "Save" }).click()
  await expect(target.getByText("Still stable")).toBeVisible()
  await expect.poll(async () => scroller.evaluate((el) => el.scrollTop)).toBeCloseTo(saved, 0)
})

test("resets virtual measurements and scroll when the review context changes", async ({ page }) => {
  const first = await openStory(page)
  const scroller = page.locator(".am-review-diff")
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

  // Move away from the origin so the context switch must reset both the
  // virtualizer's cached measurements and the shared scroller position.
  await scroller.evaluate((el) => {
    el.scrollTop = 2_000
  })
  await expect.poll(async () => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(1_000)

  await page.getByRole("button", { name: "Switch review context" }).click()
  await expect(page.getByTestId("review-context")).toHaveText("changed-context")
  await expect.poll(async () => first.evaluate((el) => el.getBoundingClientRect().height)).toBe(1_200)
  await expect.poll(async () => scroller.evaluate((el) => el.scrollTop)).toBe(0)
})

test("keeps the inline diff position stable while scrolling upward", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 })
  await page.goto(inlineStoryUrl(), { waitUntil: "load" })
  await disableAnimations(page)
  await page.waitForSelector(".am-diff-content diffs-container", { state: "attached" })

  const result = await page.locator(".am-diff-content").evaluate(async (el) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
    const settle = async (count: number) => {
      for (let i = 0; i < count; i++) await frame()
    }
    const seen = new Set(
      Array.from(el.querySelectorAll("[data-file-path]"), (row) => row.getAttribute("data-file-path")),
    )
    let remounts = 0
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue
          const rows = node.matches("[data-file-path]") ? [node] : Array.from(node.querySelectorAll("[data-file-path]"))
          for (const row of rows) {
            const file = row.getAttribute("data-file-path")
            if (seen.has(file)) remounts++
            seen.add(file)
          }
        }
      }
    })
    observer.observe(el, { childList: true, subtree: true })

    // Materialize every row once, then start from the settled bottom. The bug
    // appears when upward scrolling re-creates rows above the viewport.
    while (el.scrollTop < el.scrollHeight - el.clientHeight - 1) {
      el.scrollTop = Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + 120)
      await frame()
    }
    await settle(30)

    let correction = 0
    let range = 0
    while (el.scrollTop > 0) {
      const height = el.scrollHeight
      const intended = Math.max(0, el.scrollTop - 80)
      el.scrollTop = intended
      await settle(2)
      correction = Math.max(correction, Math.abs(el.scrollTop - intended))
      range = Math.max(range, Math.abs(el.scrollHeight - height))
    }
    observer.disconnect()
    return { correction, range, remounts }
  })

  expect(result.remounts).toBeGreaterThan(0)
  expect(result.correction).toBeLessThanOrEqual(1)
  expect(result.range).toBeLessThanOrEqual(1)
})
