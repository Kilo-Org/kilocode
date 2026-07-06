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
    await expect(page.getByRole("tab", { name: "Sandboxing" })).toHaveCount(0)
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

  test("shows sandboxing controls when the feature flag and experiment are enabled", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 720 })
    await page.goto(`/iframe.html?id=settings--sandboxing-panel&viewMode=story&globals=${GLOBALS}`, {
      waitUntil: "load",
    })

    const tab = page.getByRole("tab", { name: "Sandboxing" })
    await expect(tab).toBeVisible()
    await expect(tab).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tabpanel", { name: "Sandboxing" })).toBeVisible()
    const network = page.getByRole("switch", { name: "Restrict Network Access" })
    await expect(network).toHaveAccessibleDescription(/Local MCP servers and plugin hooks run outside this restriction/)
    await expect(network).toBeChecked()
    await page.locator('[data-slot="switch-control"]').click()
    await expect(network).not.toBeChecked()
    await expect(page.locator(".settings-save-bar")).toBeVisible()
  })
})
