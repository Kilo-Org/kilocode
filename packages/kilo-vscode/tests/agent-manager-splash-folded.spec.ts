import { expect, test } from "@playwright/test"

test("splash primary CTA requests a worktree", async ({ page }) => {
  await page.goto("/iframe.html?id=agentmanager--splash-expanded-story-1280&viewMode=story")
  await page.locator(".am-splash-actions").getByRole("button", { name: "Create Worktree", exact: true }).click()
  await expect(page.getByTestId("splash-created")).toHaveText("Worktree requested")
})

test("outside a git repository the splash explains worktrees need git and keeps the local path", async ({ page }) => {
  await page.goto("/iframe.html?id=agentmanager--splash-not-git-story-1280&viewMode=story")
  const actions = page.locator(".am-splash-actions")
  await expect(actions).toContainText("Open a folder that contains a git repository to use worktrees.")
  await expect(actions.getByRole("button", { name: "Create Worktree", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "proceed locally in the message box below", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Local prompt" })).toBeFocused()
  await expect(page.getByTestId("splash-created")).toBeHidden()
})

test("local helper supports pointer and keyboard composer focus", async ({ page }) => {
  await page.goto("/iframe.html?id=agentmanager--splash-expanded-story-1280&viewMode=story")
  const link = page.getByRole("button", { name: "proceed locally in the message box below", exact: true })
  const composer = page.getByRole("textbox", { name: "Local prompt" })
  await expect(page.locator(".am-splash-hint")).toHaveText("or proceed locally in the message box below")
  await link.click()
  await expect(composer).toBeFocused()
  for (const key of ["Enter", "Space"]) {
    await link.focus()
    await link.press(key)
    await expect(composer).toBeFocused()
  }
  await expect(page.getByTestId("splash-created")).toBeHidden()
})

test("folded bar takes the welcome header's place in the chat host", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 })
  await page.goto("/iframe.html?id=agentmanager--splash-folded-story-1280&viewMode=story")
  const header = page.locator('.am-chat-wrapper [data-slot="welcome-header"]')
  const list = page.locator('.am-chat-wrapper [data-slot="message-list"]')
  const bar = page.locator(".am-splash-folded")
  await expect(bar).toBeVisible()
  await expect(header).toHaveCSS("position", "static")
  await expect(header).toHaveCSS("padding-top", "12px")
  await expect(list.locator("..")).toHaveCSS("flex-direction", "column")
  const top = (await header.boundingBox())!
  const box = (await bar.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(top.y + top.height)
  const layout = (await page.locator(".am-splash-folded-layout").boundingBox())!
  const scroller = (await list.boundingBox())!
  expect(layout.height).toBeGreaterThanOrEqual(scroller.height - 24 - 1)

  await page.getByRole("button", { name: "Show examples" }).click()
  await expect(page.locator(".am-splash-hero")).toBeVisible()
  await expect(list.locator("..")).toHaveClass(/am-intro-layout/)
  await page.locator(".am-splash-hide").click()
  await expect(bar).toBeVisible()
  await expect(header).toHaveCSS("position", "static")
})

test("folded splash stays readable across its content-width range", async ({ page }) => {
  await page.setViewportSize({ width: 364, height: 800 })
  await page.goto("/iframe.html?id=agentmanager--splash-folded-story-1280&viewMode=story")
  const bar = page.locator(".am-splash-folded")
  await expect(bar).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await bar.locator("img").evaluate((el: HTMLImageElement) => el.decode())
  const title = bar.locator(".am-splash-folded-title")
  const note = bar.locator(".am-splash-folded-note")
  expect(await note.getAttribute("title")).toBe(await note.textContent())

  // Keep the minimum, both sides of the folded-note breakpoint, and the maximum.
  for (const width of [300, 599, 600, 1400]) {
    await test.step(`${width}px`, async () => {
      await page.setViewportSize({ width: width + 64, height: 800 })
      await page.locator(".am-splash-folded-layout").evaluate((el, width) => {
        el.style.width = `${width}px`
      }, width)
      await expect(note).toBeVisible({ visible: width >= 600 })
      await expect(title).toHaveCSS("white-space", width < 600 ? "normal" : "nowrap")
      await expect(bar).toHaveCSS("flex-direction", "row")

      const bounds = await bar.evaluate((el) => {
        const rect = (selector: string) => el.querySelector(selector)!.getBoundingClientRect()
        const box = el.getBoundingClientRect()
        const title = rect(".am-splash-folded-title")
        const logo = rect(".am-splash-folded-logo")
        const button = rect(".am-splash-show")
        return {
          width: box.width,
          overflow: el.scrollWidth > el.clientWidth,
          overlap: title.right > button.left,
          centered: Math.abs(logo.top + logo.height / 2 - (button.top + button.height / 2)),
          truncated: el.querySelector(".am-splash-folded-title")!.scrollWidth > title.width + 1,
        }
      })
      expect(bounds.width).toBeLessThanOrEqual(Math.min(width, 1120))
      expect(bounds.overflow).toBe(false)
      expect(bounds.overlap).toBe(false)
      expect(bounds.centered).toBeLessThan(1)
      expect(bounds.truncated).toBe(false)
    })
  }
})
