import { test, expect } from "@playwright/test"

test("splash carousel selects, windows and focuses cards without scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1010, height: 1000 })
  await page.goto("/iframe.html?id=agentmanager--splash-cross-stack-story-1280&viewMode=story")
  const cards = page.locator(".am-splash-card")
  const track = page.locator(".am-splash-cards")
  const dots = page.locator(".am-splash-dot")
  await expect(cards).toHaveCount(4)
  await expect(dots).toHaveCount(4)
  const heights = await cards.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1)
  const expected = ((await track.boundingBox())!.width - 20) / 3
  expect(Math.abs((await cards.first().boundingBox())!.width - expected)).toBeLessThan(1)

  for (const index of [0, 1, 2, 3]) {
    await dots.nth(index).click()
    await expect(cards.nth(index)).toHaveAttribute("aria-current", "true")
    // The three-card window keeps the selected card in the middle where possible.
    await expect
      .poll(() =>
        track.evaluate((node, index) => {
          const card = node.children.item(Math.max(0, Math.min(index - 1, 1)))!
          return Math.abs(card.getBoundingClientRect().left - node.getBoundingClientRect().left)
        }, index),
      )
      .toBeLessThan(1)
    await expect(page.locator(".am-splash-features-active .am-splash-feature-marker")).toHaveText(["1", "2", "3"])
  }
  await page.getByRole("button", { name: "Next example", exact: true }).click()
  await expect(cards.first()).toHaveAttribute("aria-current", "true")
  await page.getByRole("button", { name: "Previous example", exact: true }).click()
  await expect(cards.last()).toHaveAttribute("aria-current", "true")
  await cards.last().focus()
  await page.keyboard.press("ArrowRight")
  await expect(cards.first()).toBeFocused()
  await page.keyboard.press("End")
  await expect(cards.last()).toBeFocused()
  await page.keyboard.press("Home")
  await expect(cards.first()).toBeFocused()
  // Focusing a card never scrolls the clipped track.
  expect(await track.evaluate((node) => node.scrollLeft)).toBe(0)
})

test("splash carousel mirrors arrows, keys, the window and the selection inset in RTL", async ({ page }) => {
  await page.setViewportSize({ width: 1010, height: 1000 })
  await page.goto("/iframe.html?id=agentmanager--splash-rtl-story-1280&viewMode=story")
  const cards = page.locator(".am-splash-card")
  const dots = page.locator(".am-splash-dot")
  const track = page.locator(".am-splash-cards")
  await expect(cards).toHaveCount(4)
  for (const index of [0, 1, 2, 3]) {
    await dots.nth(index).click()
    await expect(cards.nth(index)).toHaveAttribute("aria-current", "true")
    await expect
      .poll(() =>
        track.evaluate((node, index) => {
          const card = node.children.item(Math.max(0, Math.min(index - 1, 1)))!
          return Math.abs(card.getBoundingClientRect().right - node.getBoundingClientRect().right)
        }, index),
      )
      .toBeLessThan(1)
  }
  expect(await page.locator(".am-splash-card-selected").evaluate((node) => getComputedStyle(node).boxShadow)).toContain(
    "-3px",
  )
  const scales = await page.locator('.am-splash-arrow [data-slot="icon-svg"]').evaluateAll((icons) =>
    icons.map((icon) => {
      const button = icon.closest("button")
      let scale = 1
      for (let node: Element | null = icon; node; node = node.parentElement) {
        const transform = getComputedStyle(node).transform
        scale *= transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a
        if (node === button) break
      }
      return scale
    }),
  )
  expect(scales).toEqual([-1, -1])
  await cards.last().focus()
  await page.keyboard.press("ArrowLeft")
  await expect(cards.first()).toBeFocused()
  await page.keyboard.press("ArrowRight")
  await expect(cards.last()).toBeFocused()
})
