import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const STORY_ID = "chat--message-list-layout-correction"

async function settle(page: Page, frames = 2) {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const next = (left: number) => {
          if (left === 0) return resolve()
          requestAnimationFrame(() => next(left - 1))
        }
        next(count)
      }),
    frames,
  )
}

async function distance(page: Page) {
  return page.locator(".message-list").evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)
}

test("keeps following after a stable-height layout correction", async ({ page }) => {
  await page.goto(`/iframe.html?id=${STORY_ID}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
  const list = page.locator(".message-list")
  await expect(list).toBeVisible()
  await settle(page, 10)
  await expect.poll(() => distance(page)).toBeLessThanOrEqual(2)

  const before = await list.evaluate((el) => ({ height: el.scrollHeight, top: el.scrollTop }))
  const corrected = await list.evaluate((el) => {
    el.scrollTop -= 120
    return { height: el.scrollHeight, top: el.scrollTop }
  })
  await settle(page)

  expect(corrected.height).toBe(before.height)
  expect(before.top - corrected.top).toBe(120)
  await expect(page.getByRole("button", { name: "Scroll to bottom" })).toBeHidden()

  await page.getByTestId("append-stream").click()

  await expect.poll(() => distance(page)).toBeLessThanOrEqual(2)
  await expect(page.getByRole("button", { name: "Scroll to bottom" })).toBeHidden()
})

test("keeps the reading position when the prompt rail scrolls upward", async ({ page }) => {
  await page.goto(`/iframe.html?id=${STORY_ID}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
  const list = page.locator(".message-list")
  await expect(list).toBeVisible()
  await settle(page, 10)
  await expect.poll(() => distance(page)).toBeLessThanOrEqual(2)

  await page.locator(".prompt-rail").hover()
  await page.mouse.wheel(0, -240)

  await expect.poll(() => distance(page)).toBeGreaterThan(40)
  await expect(page.getByRole("button", { name: "Scroll to bottom" })).toBeVisible()
  const top = await list.evaluate((el) => el.scrollTop)

  await page.getByTestId("append-stream").click()

  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(top)
  await expect(page.getByRole("button", { name: "Scroll to bottom" })).toBeVisible()
})
