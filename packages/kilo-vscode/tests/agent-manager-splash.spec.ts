import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const mode = (width: number) => (width < 560 ? "thin" : width < 880 ? "narrow" : "wide")

async function open(page: Page, theme = "dark-modern", story = "cross-stack") {
  await page.goto(
    `/iframe.html?id=agentmanager--splash-${story}-story-1280&viewMode=story&globals=theme:kilo-vscode;vscodeTheme:${theme}`,
  )
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
  await expect(page.locator(".am-splash-dots")).toBeVisible({ visible: width >= 880 })
}

const controls = (page: Page, width: number) => page.locator(width < 880 ? ".am-splash-tab" : ".am-splash-dot")

/** Visible copy is never clamped, clipped or pushed outside the card. */
async function intact(page: Page) {
  const issues = await page.locator(".am-splash-hero").evaluate((hero) => {
    const bounds = hero.getBoundingClientRect()
    const issues: string[] = []
    if (hero.scrollWidth > hero.clientWidth + 1) issues.push("hero horizontal overflow")
    for (const node of hero.querySelectorAll<HTMLElement>(
      ".am-splash-eyebrow,.am-splash-hide,.am-splash-title,.am-splash-subtitle,.am-splash-card-title,.am-splash-card-tag,.am-splash-pitch,.am-splash-feature strong,.am-splash-feature-description,.am-splash-tab,.am-splash-hint,.am-splash-actions [data-component=button]",
    )) {
      const style = getComputedStyle(node)
      if (style.visibility === "hidden" || !node.checkVisibility()) continue
      const label = node.textContent?.trim() ?? node.className
      if (!["none", "", "0"].includes(style.webkitLineClamp)) issues.push(`clamped: ${label}`)
      if (node.scrollHeight > node.clientHeight + 1) issues.push(`vertical clipping: ${label}`)
      if (node.scrollWidth > node.clientWidth + 1) issues.push(`horizontal clipping: ${label}`)
      const box = node.getBoundingClientRect()
      // Tabs scroll and cards slide out of the clipped carousel window.
      const scrolled = node.closest(".am-splash-tabs, .am-splash-cards")
      if (!scrolled && (box.left < bounds.left - 1 || box.right > bounds.right + 1)) {
        issues.push(`outside hero: ${label}`)
      }
    }
    return issues
  })
  expect(issues).toEqual([])
}

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

test("expanded splash preserves copy, stacked previews and content-box breakpoints", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1600 })
  await open(page)
  const card = page.locator(".am-splash-preview-card")
  // Sample each mode at its constrained end; screenshots cover the wider appearance.
  for (const width of [880, 560, 300]) {
    await test.step(`${mode(width)} at ${width}px across every example`, async () => {
      await resize(page, width)
      await expect(page.locator(".am-splash-stepper")).toHaveCount(0)
      await expect(page.locator(".am-splash-feature-stack")).toBeVisible({ visible: width >= 560 })
      await expect(page.locator(".am-splash-legend")).toBeVisible({ visible: width >= 880 })
      const heights: number[] = []
      const height = await card.evaluate((node) => node.getBoundingClientRect().height)
      for (const control of await controls(page, width).all()) {
        await control.click()
        await expect(page.locator(".am-splash-example-panel-active:visible")).toHaveCount(1)
        await expect.poll(() => card.evaluate((node) => node.getBoundingClientRect().height)).toBe(height)
        await expect(card.locator(".am-splash-preview-fleet")).toHaveCount(4)
        await expect(card.locator(".am-splash-preview-fleet-active .am-splash-row-marker")).toHaveCount(3)
        await expect(card.locator(".am-splash-row-marker:visible")).toHaveCount(width < 560 ? 0 : 3)
        await expect(page.locator(".am-splash-example-panel-active .am-splash-pitch:visible")).toHaveCount(1)
        await expect(page.getByRole("button", { name: "Create Worktree", exact: true })).toBeVisible()
        await expect.poll(() => framed(page)).toBe(true)
        await intact(page)
        heights.push(await page.locator(".am-splash-hero").evaluate((node) => node.getBoundingClientRect().height))
        if (mode(width) !== "narrow") continue
        // The numbered list sits beside the preview and each description wraps below its name.
        const features = (await page.locator(".am-splash-feature-stack").boundingBox())!
        const side = (await card.boundingBox())!
        expect(features.x + features.width <= side.x + 1 || side.x + side.width <= features.x + 1).toBe(true)
        for (const feature of await page.locator(".am-splash-features-active .am-splash-feature-text").all()) {
          const title = (await feature.locator("strong").boundingBox())!
          const description = (await feature.locator(".am-splash-feature-description").boundingBox())!
          expect(description.y).toBeGreaterThanOrEqual(title.y + title.height - 1)
        }
      }
      expect(heights).toHaveLength(4)
      expect(Math.max(...heights) - Math.min(...heights)).toBe(0)
    })
  }
  await test.step("exact breakpoints ignore the viewport and parent padding", async () => {
    await page.locator(".am-splash").evaluate((node) => {
      ;(node as HTMLElement).style.padding = "17px"
      node.parentElement!.style.padding = "23px"
    })
    for (const viewport of [1500, 500]) {
      await page.setViewportSize({ width: viewport, height: 1600 })
      for (const width of [559, 560, 879, 880]) {
        await resize(page, width)
        await expect(page.locator(".am-splash-feature-stack")).toBeVisible({ visible: width >= 560 })
        await expect(page.locator(".am-splash-row-marker:visible")).toHaveCount(width < 560 ? 0 : 3)
        await expect.poll(() => framed(page)).toBe(true)
      }
    }
  })
})

test("selection survives every layout change", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1600 })
  await open(page)
  await resize(page, 879)
  await page.locator(".am-splash-tab").nth(3).click()
  await resize(page, 880)
  await expect(page.locator(".am-splash-card").nth(3)).toHaveAttribute("aria-current", "true")
  await page.locator(".am-splash-dot").nth(1).click()
  await resize(page, 340)
  await expect(page.locator(".am-splash-tab").nth(1)).toHaveAttribute("aria-selected", "true")
})

test("stacked previews adapt to changed font metrics and stay stable when switching examples", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1600 })
  await open(page)
  const card = page.locator(".am-splash-preview-card")
  const before = await card.evaluate((node) => node.getBoundingClientRect().height)
  await page.addStyleTag({
    content: ".am-splash-preview-card { --font-size-base: 24px; font-family: monospace; line-height: 2; }",
  })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await expect.poll(() => card.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(before)
  for (const width of [340, 720, 1010, 559, 560]) {
    await resize(page, width)
    const height = await card.evaluate((node) => node.getBoundingClientRect().height)
    for (const control of await controls(page, width).all()) {
      await control.click()
      await expect.poll(() => card.evaluate((node) => node.getBoundingClientRect().height)).toBe(height)
      await expect.poll(() => framed(page)).toBe(true)
    }
  }
})

test("wide and narrow features ring only the paired badge across examples", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1600 })
  await open(page)
  for (const width of [720, 1010]) {
    await resize(page, width)
    for (const control of await controls(page, width).all()) {
      await control.click()
      const badges = page.locator(".am-splash-preview-fleet-active .am-splash-row-marker")
      await expect(badges).toHaveCount(3)
      await expect(page.locator(".am-splash-preview-fleet-active .am-splash-row-marker-hover")).toHaveCount(0)
      for (const [index, feature] of (
        await page.locator(".am-splash-features-active .am-splash-feature").all()
      ).entries()) {
        await feature.hover()
        await expect(page.locator(".am-splash-preview-fleet-active .am-splash-row-marker-hover")).toHaveText(
          String(index + 1),
        )
        await expect(badges.filter({ hasText: String(index + 1) })).not.toHaveCSS("box-shadow", "none")
        await expect
          .poll(() =>
            badges
              .filter({ hasNotText: String(index + 1) })
              .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).boxShadow)),
          )
          .toEqual(["none", "none"])
      }
      await page.mouse.move(0, 0)
      await expect(page.locator(".am-splash-row-marker-hover")).toHaveCount(0)
    }
  }
})

// Dark-mode examples and layout states belong to the shared accessibility ratchet.
test("hc-light splash passes axe and keeps the CTA focus gap", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 })
  await open(page, "hc-light")
  const result = await new AxeBuilder({ page }).include(".am-splash-hero").analyze()
  expect(result.violations.map((rule) => rule.id)).toEqual([])
  await page.keyboard.press("Tab")
  const button = page.locator('.am-splash-actions [data-component="button"]')
  await button.focus()
  expect(await button.evaluate((node) => node.matches(":focus-visible"))).toBe(true)
  await expect(button).toHaveCSS("outline-style", "solid")
  expect(
    await button.evaluate((node) => Number.parseFloat(getComputedStyle(node).outlineOffset)),
  ).toBeGreaterThanOrEqual(2)
})

test("reduced motion disables splash control transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.setViewportSize({ width: 1500, height: 1600 })
  await open(page)
  await resize(page, 340)
  const durations = await page
    .locator(".am-splash-hero button:visible")
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).transitionDuration))
  expect(durations.length).toBeGreaterThan(0)
  expect(durations.every((duration) => duration === "0s")).toBe(true)
})

test("compact tabs rove focus, link panels and keep the chosen tab in view", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1600 })
  await open(page)
  await resize(page, 300)
  const tabs = page.locator(".am-splash-tab")
  const panels = page.locator(".am-splash-compact-panel")
  await tabs.first().click()
  for (const [key, index] of [
    ["ArrowRight", 1],
    ["ArrowLeft", 0],
    ["End", 3],
    ["Home", 0],
  ] as const) {
    await page.keyboard.press(key)
    await expect(tabs.nth(index)).toBeFocused()
    await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tabpanel")).toHaveCount(1)
    const panel = panels.nth(index)
    await expect(panel).toBeVisible()
    await expect(panel).toHaveAttribute("aria-labelledby", (await tabs.nth(index).getAttribute("id"))!)
    await expect
      .poll(() =>
        tabs.nth(index).evaluate((node) => {
          const tab = node.getBoundingClientRect()
          const list = node.closest('[role="tablist"]')!.getBoundingClientRect()
          return tab.left >= list.left - 1 && tab.right <= list.right + 1
        }),
      )
      .toBe(true)
  }
  // Clicking a tab that is partly scrolled out of view brings it fully into view.
  const list = page.getByRole("tablist")
  const edge = (await list.boundingBox())!
  await list.evaluate((node) => node.scrollTo({ left: 0 }))
  const last = (await tabs.nth(2).boundingBox())!
  await page.mouse.click(Math.min(last.x + 2, edge.x + edge.width - 2), last.y + last.height / 2)
  await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true")
  await expect
    .poll(() =>
      tabs.nth(2).evaluate((node) => {
        const tab = node.getBoundingClientRect()
        const box = node.closest('[role="tablist"]')!.getBoundingClientRect()
        return tab.left >= box.left - 1 && tab.right <= box.right + 1
      }),
    )
    .toBe(true)
})

test("tab edge fades show only where tabs scroll out of view", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1600 })
  await open(page)
  const list = page.getByRole("tablist")
  // A fade paints when it is displayed, visible and has a real box over the tabs.
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
  // Widening past the overflow while scrolled to the end clears both fades.
  await resize(page, 879)
  await expect.poll(fades).toEqual([false, false])
  // Each fade spans the tab row's height and overlays the tabs without taking room.
  const tab = (await page.locator(".am-splash-tab").first().boundingBox())!
  const height = await list.evaluate((node) => Number.parseFloat(getComputedStyle(node, "::after").height))
  expect(height).toBeGreaterThanOrEqual(tab.height)
  const offset = await list.evaluate(
    (node) => node.querySelector(".am-splash-tab")!.getBoundingClientRect().left - node.getBoundingClientRect().left,
  )
  expect(offset).toBe(0)
})

test("focus traversal skips the preview and every stop shows a focus ring", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1600 })
  await open(page)
  for (const width of [340, 720, 1100]) {
    await resize(page, width)
    const hide = page.getByRole("button", { name: "Hide Agent Manager introduction", exact: true })
    await hide.focus()
    const order: string[] = []
    for (let index = 0; index < 20; index++) {
      await page.keyboard.press("Tab")
      const stop = await page.evaluate(() => {
        const node = document.activeElement!
        if (!node.closest(".am-splash")) return null
        if (node.closest(".am-splash-preview-card")) return "preview"
        const style = getComputedStyle(node)
        if (!node.matches(":focus-visible") || style.outlineStyle === "none") return "no ring"
        if (node.matches('.am-splash-actions [data-component="button"]') && Number.parseFloat(style.outlineOffset) < 2)
          return "no gap"
        return node.getAttribute("aria-label") ?? node.textContent?.trim() ?? ""
      })
      if (stop === null) break
      order.push(stop)
    }
    expect(order).not.toContain("preview")
    expect(order).not.toContain("no ring")
    expect(order).not.toContain("no gap")
    expect(order.at(-2)).toBe("Create Worktree")
    expect(order.at(-1)).toBe("proceed locally in the message box below")
  }
})

test("Show, Hide and resize cycles emit no window errors", async ({ page }) => {
  await page.addInitScript(() => {
    const errors: string[] = []
    window.addEventListener("error", (event) => errors.push(event.message))
    Object.defineProperty(window, "splashErrors", { value: errors })
  })
  await page.setViewportSize({ width: 1100, height: 1400 })
  await page.goto("/iframe.html?id=agentmanager--splash-folded-story-1280&viewMode=story")
  await page.locator(".am-splash-show").click()
  for (let cycle = 0; cycle < 3; cycle++) {
    await expect(page.locator(".am-splash-dots")).toBeVisible()
    await page.setViewportSize({ width: 520, height: 1400 })
    await expect(page.locator(".am-splash-tabs")).toBeVisible()
    await page.setViewportSize({ width: 1100, height: 1400 })
    await expect(page.locator(".am-splash-dots")).toBeVisible()
    await page.locator(".am-splash-hide").click()
    const reopen = page.getByRole("button", { name: "How Agent Manager works" })
    await expect(reopen).toBeVisible()
    await reopen.click()
    await expect(page.locator(".am-splash-hero")).toBeVisible()
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(await page.evaluate(() => Reflect.get(window, "splashErrors") as string[])).toEqual([])
})
