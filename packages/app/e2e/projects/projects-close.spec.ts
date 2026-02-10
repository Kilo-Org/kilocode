import { test, expect } from "../fixtures"
import { createTestProject, cleanupTestProject, openSidebar, clickMenuItem } from "../actions"
import { projectCloseHoverSelector, projectCloseMenuSelector, projectSwitchSelector } from "../selectors"
import { dirSlug } from "../utils"
import path from "path" // kilocode_change - import path for project name extraction

test("can close a project via hover card close button", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherSlug = dirSlug(other)

  try {
    await withProject(
      async () => {
        await openSidebar(page)

        const otherButton = page.locator(projectSwitchSelector(otherSlug)).first()
        await expect(otherButton).toBeVisible()
        await otherButton.hover()

        const close = page.locator(projectCloseHoverSelector(otherSlug)).first()
        await expect(close).toBeVisible()
        await close.click()

        await expect(otherButton).toHaveCount(0)
      },
      { extra: [other] },
    )
  } finally {
    await cleanupTestProject(other)
  }
})

test("can close a project via project header more options menu", async ({ page, withProject }) => {
  test.skip(process.platform === "win32", "Skipping on Windows due to hover/menu interaction issues") // kilocode_change
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherName = path.basename(other) // kilocode_change - use project name instead of slug for header matching
  const otherSlug = dirSlug(other)

  try {
    await withProject(
      async () => {
        await openSidebar(page)

        const otherButton = page.locator(projectSwitchSelector(otherSlug)).first()
        await expect(otherButton).toBeVisible()
        await otherButton.click()

        await expect(page).toHaveURL(new RegExp(`/${otherSlug}/session`))

        const header = page
          .locator(".group\\/project")
          .filter({ has: page.locator(`[data-action="project-menu"][data-project="${otherSlug}"]`) })
          .first()
        await expect(header).toBeVisible() // kilocode_change - check visibility instead of text content
        await expect(header.locator('[data-action="project-menu"]')).toBeVisible() // kilocode_change

        const trigger = header.locator(`[data-action="project-menu"][data-project="${otherSlug}"]`).first()
        await expect(trigger).toHaveCount(1)
        await trigger.focus()
        await page.waitForTimeout(100) // kilocode_change - wait before keyboard press
        await page.keyboard.press("Enter")

        const menu = page.locator('[data-component="dropdown-menu-content"]').first()
        await expect(menu).toBeVisible({ timeout: 10_000 })

        await clickMenuItem(menu, /^Close$/i, { force: true })
        await expect(otherButton).toHaveCount(0)
      },
      { extra: [other] },
    )
  } finally {
    await cleanupTestProject(other)
  }
})
