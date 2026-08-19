import { expect, test, type Page } from "@playwright/test"

/**
 * The row above the composer swaps the working indicator for the session
 * actions when a turn finishes. It used to grow by the actions row while the
 * in-transcript indicator placeholder shrank, and the leftover difference
 * pushed the conversation text up by a few pixels on every turn boundary.
 *
 * Measure the real geometry across that swap: the dock height, the transcript
 * viewport height, and the on-screen position of the last message all have to
 * stay put.
 */

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const STORY_ID = "chat--chat-view-session-dock-stability"

async function openStory(page: Page) {
  await page.setViewportSize({ width: 720, height: 640 })
  await page.goto(`/iframe.html?id=${STORY_ID}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
  await page.addStyleTag({
    content: `*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }`,
  })
  await page.waitForSelector('[data-component="session-dock"]')
}

async function geometry(page: Page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return page.evaluate(() => {
    const dock = document.querySelector('[data-component="session-dock"]')
    const list = document.querySelector(".message-list")
    if (!(dock instanceof HTMLElement) || !(list instanceof HTMLElement)) throw new Error("dock or transcript missing")
    return {
      dock: dock.getBoundingClientRect().height,
      viewport: list.getBoundingClientRect().height,
      transcriptBottom: list.getBoundingClientRect().bottom,
    }
  })
}

test("session dock keeps the transcript still across the working swap", async ({ page }) => {
  await openStory(page)

  const idle = await geometry(page)
  expect(idle.dock).toBeGreaterThan(0)

  await page.getByTestId("toggle-busy").click()
  await expect(page.locator(".working-indicator")).toBeVisible()
  const working = await geometry(page)

  expect(working.dock).toBe(idle.dock)
  expect(working.viewport).toBe(idle.viewport)
  expect(working.transcriptBottom).toBe(idle.transcriptBottom)

  await page.getByTestId("toggle-busy").click()
  await expect(page.locator(".new-task-button-wrapper")).toBeVisible()
  const back = await geometry(page)

  expect(back.dock).toBe(idle.dock)
  expect(back.viewport).toBe(idle.viewport)
  expect(back.transcriptBottom).toBe(idle.transcriptBottom)
})

test("only one of the two states is visible in the dock", async ({ page }) => {
  await openStory(page)

  // Both states stay laid out so the row keeps reserving the taller height;
  // only visibility changes.
  await expect(page.locator('[data-component="session-dock"] .new-task-button-wrapper')).toBeVisible()
  await expect(page.locator('[data-component="session-dock"] .working-indicator')).toBeHidden()

  await page.getByTestId("toggle-busy").click()

  await expect(page.locator('[data-component="session-dock"] .working-indicator')).toBeVisible()
  await expect(page.locator('[data-component="session-dock"] .new-task-button-wrapper')).toBeHidden()
})

test("the indicator stays a centered lane on a wide surface", async ({ page }) => {
  await openStory(page)
  // Agent Manager width: a full-width indicator put the spinner at the far-left
  // edge and pinned the elapsed time to the far-right edge.
  await page.setViewportSize({ width: 1400, height: 640 })
  await page.getByTestId("toggle-busy").click()
  await expect(page.locator('[data-component="session-dock"] .working-indicator')).toBeVisible()

  const lane = await page.evaluate(() => {
    const dock = document.querySelector('[data-component="session-dock"]')
    const indicator = document.querySelector(".working-indicator")
    if (!(dock instanceof HTMLElement) || !(indicator instanceof HTMLElement)) throw new Error("dock missing")
    const d = dock.getBoundingClientRect()
    // Measure the painted cluster (spinner, label, counter), not the box around it.
    const parts = [...indicator.children].map((el) => el.getBoundingClientRect())
    const left = Math.min(...parts.map((p) => p.left))
    const right = Math.max(...parts.map((p) => p.right))
    return {
      dockWidth: d.width,
      clusterWidth: right - left,
      leftGap: left - d.left,
      rightGap: d.right - right,
      spread: right - left,
    }
  })

  // The cluster stays compact instead of reaching for both edges of the surface.
  expect(lane.clusterWidth).toBeLessThan(lane.dockWidth / 2)
  // and sits on the dock's centre axis, like the actions row it replaces.
  expect(lane.leftGap).toBeGreaterThan(0)
  expect(Math.abs(lane.leftGap - lane.rightGap)).toBeLessThanOrEqual(2)
})

test("the counter keeps its width as it ticks", async ({ page }) => {
  await openStory(page)
  await page.getByTestId("toggle-busy").click()
  const elapsed = page.locator(".working-elapsed")
  await expect(elapsed).toBeVisible()

  // A one-character growth (9s to 10s) must not reflow the cluster.
  const before = await elapsed.evaluate((el) => el.getBoundingClientRect().width)
  const wide = await elapsed.evaluate((el) => {
    const original = el.textContent
    el.textContent = "10s"
    const width = el.getBoundingClientRect().width
    el.textContent = original
    return width
  })

  expect(wide).toBe(before)
})

test("a wrapped narrow-sidebar actions row is not clipped", async ({ page }) => {
  await openStory(page)
  // Narrow enough for the container query to wrap the actions row onto a
  // second line, which a hard-coded dock height cut off behind the composer.
  await page.setViewportSize({ width: 340, height: 640 })

  const wrapped = await page.evaluate(() => {
    const dock = document.querySelector('[data-component="session-dock"]')
    const row = document.querySelector(".session-actions-row")
    if (!(dock instanceof HTMLElement) || !(row instanceof HTMLElement)) throw new Error("dock or actions missing")
    return {
      dock: dock.getBoundingClientRect().height,
      row: row.getBoundingClientRect().height,
      overflowBelow: row.getBoundingClientRect().bottom - dock.getBoundingClientRect().bottom,
    }
  })

  expect(wrapped.row).toBeGreaterThan(0)
  expect(wrapped.dock).toBeGreaterThanOrEqual(wrapped.row)
  expect(wrapped.overflowBelow).toBeLessThanOrEqual(0)

  // The swap still leaves the transcript untouched at this width.
  const idle = await geometry(page)
  await page.getByTestId("toggle-busy").click()
  await expect(page.locator('[data-component="session-dock"] .working-indicator')).toBeVisible()
  const working = await geometry(page)

  expect(working.dock).toBe(idle.dock)
  expect(working.viewport).toBe(idle.viewport)
  expect(working.transcriptBottom).toBe(idle.transcriptBottom)
})
