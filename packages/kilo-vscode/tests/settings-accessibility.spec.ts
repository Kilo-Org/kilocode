import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const NAMES = [
  "Models",
  "Providers",
  "Agent Behaviour",
  "Auto-Approve",
  "Browser",
  "Checkpoints",
  "Display",
  "Autocomplete",
  "Notifications",
  "Context",
  "Commit Message",
  "Experimental",
  "Language",
  "About Kilo Code",
]

function story(page: Page) {
  return page.goto(`/iframe.html?id=settings--settings-panel&viewMode=story&globals=${GLOBALS}`, {
    waitUntil: "load",
  })
}

test.describe("settings tab accessibility", () => {
  test("exposes named tabs and selected state in the compact sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 720 })
    await story(page)

    const tabs = page.getByRole("tab")
    await expect(tabs).toHaveCount(NAMES.length)
    for (const name of NAMES) {
      await expect(page.getByRole("tab", { name, exact: true })).toBeVisible()
    }

    const models = page.getByRole("tab", { name: "Models" })
    const providers = page.getByRole("tab", { name: "Providers" })
    await expect(models).toHaveAttribute("aria-selected", "true")
    await expect(providers).toHaveAttribute("aria-selected", "false")
    await expect(page.getByRole("tabpanel", { name: "Models" })).toBeVisible()

    await models.focus()
    await page.keyboard.press("ArrowDown")
    await expect(providers).toBeFocused()
    await expect(providers).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tabpanel", { name: "Providers" })).toBeVisible()

    await page.keyboard.press("ArrowUp")
    await expect(models).toBeFocused()
    await expect(models).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tabpanel", { name: "Models" })).toBeVisible()
  })
})
