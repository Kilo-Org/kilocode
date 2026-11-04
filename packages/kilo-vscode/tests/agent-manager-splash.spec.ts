import { expect, test, type Page } from "@playwright/test"

async function open(page: Page) {
  await page.goto("/iframe.html?id=agentmanager--splash-cross-stack-story-1280&viewMode=story")
  await expect(page.locator(".am-splash-hero")).toBeVisible()
}

/** Sets the splash's content width, which is what its container queries follow. */
async function resize(page: Page, width: number) {
  await page.locator(".am-splash").evaluate((node, width) => {
    const root = node as HTMLElement
    root.style.width = `${width}px`
    root.style.maxWidth = "none"
    root.style.boxSizing = "content-box"
    root.style.flex = "none"
  }, width)
  await expect(page.locator(".am-splash-tabs")).toBeVisible({ visible: width < 880 })
  await expect(page.locator(".am-splash-cards")).toBeVisible({ visible: width >= 880 })
}

const controls = (page: Page, width: number) => page.locator(width < 880 ? ".am-splash-tab" : ".am-splash-card")

/** Every fixture row fits without scrolling, cropping or a mask, even without badges. */
async function framed(page: Page) {
  return page.locator(".am-splash-preview-card").evaluate((card) => {
    const fleet = card.querySelector(".am-splash-preview-fleet-active")!
    const list = fleet.querySelector<HTMLElement>(".am-projects-list")!
    const box = card.getBoundingClientRect()
    return (
      list.scrollTop === 0 &&
      list.scrollHeight <= list.clientHeight + 1 &&
      getComputedStyle(list).maskImage === "none" &&
      [
        ...fleet.querySelectorAll(".am-project-item, .am-worktree-item, .am-section-group-header, .am-wt-group-header"),
      ].every((row) => {
        const rect = row.getBoundingClientRect()
        return rect.top >= box.top && rect.bottom <= box.bottom
      })
    )
  })
}

test("content width picks the layout and every example stays readable", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1600 })
  await open(page)
  const card = page.locator(".am-splash-preview-card")
  await page.locator(".am-splash").evaluate((node) => {
    ;(node as HTMLElement).style.padding = "17px"
    node.parentElement!.style.padding = "23px"
  })
  for (const width of [300, 559, 560, 879, 880]) {
    await test.step(`${width}px`, async () => {
      await resize(page, width)
      await expect(page.locator(".am-splash-feature-stack")).toBeVisible({ visible: width >= 560 })
      await expect(page.locator(".am-splash-legend")).toBeVisible({ visible: width >= 880 })
      const height = await card.evaluate((node) => node.getBoundingClientRect().height)
      const hero = await page.locator(".am-splash-hero").evaluate((node) => node.getBoundingClientRect().height)
      for (const control of await controls(page, width).all()) {
        await control.click()
        await expect(page.locator(".am-splash-example-panel-active:visible")).toHaveCount(1)
        await expect.poll(() => card.evaluate((node) => node.getBoundingClientRect().height)).toBe(height)
        await expect
          .poll(() => page.locator(".am-splash-hero").evaluate((node) => node.getBoundingClientRect().height))
          .toBe(hero)
        await expect(card.locator(".am-splash-row-marker:visible")).toHaveCount(width < 560 ? 0 : 3)
        await expect(page.locator(".am-splash-example-panel-active .am-splash-pitch:visible")).toHaveCount(1)
        await expect(page.getByRole("button", { name: "Create Worktree", exact: true })).toBeVisible()
        await expect.poll(() => framed(page)).toBe(true)
      }
    })
  }
})

test("example selection works with cards and tabs, including RTL", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1600 })
  await open(page)
  const cards = page.locator(".am-splash-card")
  await cards.last().click()
  await expect(cards.last()).toHaveAttribute("aria-current", "true")
  await expect(cards.first()).not.toHaveAttribute("aria-current", "true")
  await cards.first().focus()
  await page.keyboard.press("Enter")
  await expect(cards.first()).toHaveAttribute("aria-current", "true")
  await expect(cards.first()).toBeFocused()

  await resize(page, 879)
  const tabs = page.locator(".am-splash-tab")
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true")
  await tabs.first().focus()
  await page.keyboard.press("ArrowRight")
  await expect(tabs.nth(1)).toBeFocused()
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true")
  await expect(page.locator(".am-splash-compact-panel:visible")).toHaveCount(1)
  await page.goto("/iframe.html?id=agentmanager--splash-rtl-story-1280&viewMode=story")
  const rtl = page.locator(".am-splash-card")
  const order = await rtl.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().x))
  expect(order[0]).toBeGreaterThan(order[1]!)
  await rtl.first().focus()
  await page.keyboard.press("Enter")
  await expect(rtl.first()).toHaveAttribute("aria-current", "true")
})

test("preview fleets are inert and only the active one is reachable", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1600 })
  await open(page)
  for (const control of await page.locator(".am-splash-card").all()) {
    await control.click()
    const fleets = page.locator(".am-splash-preview-fleet")
    const count = await fleets.count()
    expect(count).toBeGreaterThan(1)
    await expect(page.locator(".am-splash-preview-fleet[aria-hidden='true'][inert]")).toHaveCount(count)
    await expect(page.locator(".am-splash-preview-fleet-active")).toHaveCount(1)
    await expect(page.locator(".am-splash-preview-fleet-active .am-splash-row-marker")).toHaveCount(3)
  }
})

// A shared kilo-ui tabs rule hid these fades once; a screenshot alone won't catch a missing painted box.
test("tab edge fades paint only where tabs scroll out of view", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1600 })
  await open(page)
  const list = page.getByRole("tablist")
  const fades = () =>
    list.evaluate((node) =>
      ["::before", "::after"].map((side) => {
        const style = getComputedStyle(node, side)
        const size = [style.width, style.height].map(Number.parseFloat)
        return style.display !== "none" && style.visibility === "visible" && size.every((value) => value > 0)
      }),
    )
  await resize(page, 300)
  expect(await list.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
  await expect.poll(fades).toEqual([false, true])
  await list.evaluate((node) => node.scrollTo({ left: node.scrollWidth }))
  await expect.poll(fades).toEqual([true, false])
})

test("fold, hide and reopen keep the chat host's introduction contract", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "splashErrors", { value: [] })
    window.addEventListener("error", (event) => Reflect.get(window, "splashErrors").push(event.message))
  })
  await page.setViewportSize({ width: 1100, height: 1400 })
  await page.goto("/iframe.html?id=agentmanager--splash-folded-story-1280&viewMode=story")
  const host = page.locator('.am-chat-wrapper [data-slot="message-list"]').locator("..")
  await expect(page.locator(".am-splash-folded")).toBeVisible()
  await expect(host).not.toHaveClass(/am-intro-layout/)
  await page.getByRole("button", { name: "Show examples" }).click()
  await expect(page.locator(".am-splash-hero")).toBeVisible()
  await expect(host).toHaveClass(/am-intro-layout/)
  await page.locator(".am-splash-hide").click()
  await expect(page.locator(".am-splash-hero, .am-splash-folded")).toHaveCount(0)
  await expect(host).not.toHaveClass(/am-intro-layout/)
  const reopen = page.getByRole("button", { name: "How Agent Manager works" })
  await expect(reopen).toBeVisible()
  await reopen.click()
  await expect(page.locator(".am-splash-hero")).toBeVisible()
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(await page.evaluate(() => Reflect.get(window, "splashErrors") as string[])).toEqual([])
})
