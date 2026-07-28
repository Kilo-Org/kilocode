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

  test("shows sandboxing controls when the platform supports them", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 720 })
    await page.goto(`/iframe.html?id=settings--sandboxing-panel&viewMode=story&globals=${GLOBALS}`, {
      waitUntil: "load",
    })

    const tab = page.getByRole("tab", { name: "Sandboxing" })
    await expect(tab).toBeVisible()
    await expect(tab).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tabpanel", { name: "Sandboxing" })).toBeVisible()
    const sandbox = page.getByRole("switch", { name: "Sandbox", exact: true })
    await expect(sandbox).toHaveAccessibleDescription(/restricts writes to the project and Kilo state directories/)
    await expect(sandbox).not.toBeChecked()
    const network = page.getByRole("switch", { name: "Restrict Network Access" })
    await expect(network).toHaveAccessibleDescription(/MCP tools are unavailable while restricted/)
    await expect(network).toBeChecked()
    await expect(network).toBeDisabled()
    const host = page.getByRole("textbox", { name: "Allowed Network Destinations" })
    await expect(host).toBeDisabled()
    const path = page.getByRole("textbox", { name: "Additional Writable Paths" })
    await expect(path).toBeDisabled()
    const add = page.getByRole("button", { name: "Add" })
    await expect(add).toHaveCount(2)
    await expect(add.nth(0)).toBeDisabled()
    await expect(add.nth(1)).toBeDisabled()
    await page.locator('[data-slot="switch-control"]').nth(0).click()
    await expect(sandbox).toBeChecked()
    await expect(network).toBeEnabled()
    await expect(host).toBeEnabled()
    await expect(path).toBeEnabled()
    await page.locator('[data-slot="switch-control"]').nth(1).click()
    await expect(network).not.toBeChecked()
    await expect(host).toBeDisabled()
    await expect(path).toBeEnabled()
    await expect(page.locator(".settings-save-bar")).toBeVisible()
  })
})
