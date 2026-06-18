import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

function story(page: Page, id: string) {
  return page.goto(`/iframe.html?id=${id}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
}

test.describe("history session accessibility", () => {
  test("opens a selected session through a standalone named row control", async ({ page }) => {
    await story(page, "history-sessionlist--with-items")

    const row = page.getByRole("button", { name: /Refactor authentication module.*Current session/ })
    await expect(row).toHaveAttribute("data-selected", "true")
    await expect(page.locator('[data-slot="list-item"] button')).toHaveCount(0)

    await row.focus()
    await page.keyboard.press("Enter")
    await expect(page.locator('[data-slot="selected-session"]')).toHaveText("s1")
  })

  test("announces the active filtered result before Enter opens it", async ({ page }) => {
    await story(page, "history-sessionlist--with-items")

    const search = page.getByPlaceholder("Search sessions...")
    await search.fill("screenshot")
    await expect(search).toBeFocused()
    await expect(page.locator('[data-slot="session-list-status"]')).toHaveText("Add screenshot test coverage")

    await page.keyboard.press("Enter")
    await expect(page.locator('[data-slot="selected-session"]')).toHaveText("s2")
  })

  test("focuses row actions without opening a session during rename", async ({ page }) => {
    await story(page, "history-sessionlist--with-items")

    const selected = page.locator('[data-slot="selected-session"]')
    const rename = page.getByRole("button", { name: "Rename: Add screenshot test coverage" })
    await rename.focus()
    await expect(rename).toBeFocused()
    await page.keyboard.press("Enter")
    const input = page.getByRole("textbox", { name: "Rename" })
    await expect(input).toBeFocused()
    await expect(selected).toBeEmpty()

    await input.fill("Updated screenshot test coverage")
    await page.keyboard.press("Enter")
    await expect(input).toBeHidden()
    await expect(selected).toBeEmpty()

    const renamed = page.getByRole("button", { name: "Rename: Add screenshot test coverage" })
    await renamed.focus()
    await page.keyboard.press("Enter")
    await expect(input).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(input).toBeHidden()
    await expect(selected).toBeEmpty()
  })

  test("deleting does not open a session and restores focus after cancel", async ({ page }) => {
    await story(page, "history-sessionlist--with-items")

    const selected = page.locator('[data-slot="selected-session"]')
    const remove = page.getByRole("button", { name: "Delete session: Add screenshot test coverage" })
    await remove.focus()
    await expect(remove).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("dialog", { name: "Delete session" })).toBeVisible()
    await expect(selected).toBeEmpty()

    await page.getByRole("button", { name: "Cancel" }).click()
    await expect(page.getByRole("dialog", { name: "Delete session" })).toBeHidden()
    await expect(remove).toBeFocused()
    await expect(selected).toBeEmpty()
  })

  test("exposes Local and Cloud as keyboard navigable selected tabs", async ({ page }) => {
    await story(page, "history-sessionlist--sources")

    const local = page.getByRole("tab", { name: "Local" })
    const cloud = page.getByRole("tab", { name: "Cloud" })
    await expect(page.getByRole("tablist", { name: "History source" })).toBeVisible()
    await expect(local).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tabpanel", { name: "Local" })).toBeVisible()

    await local.focus()
    await page.keyboard.press("ArrowRight")
    await expect(cloud).toBeFocused()
    await expect(local).toHaveAttribute("aria-selected", "true")
    await page.keyboard.press("Enter")
    await expect(cloud).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tabpanel", { name: "Cloud" })).toBeVisible()
    await expect(page.getByPlaceholder("Search sessions...")).toBeFocused()

    await cloud.focus()
    await page.keyboard.press("ArrowLeft")
    await expect(local).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(local).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tabpanel", { name: "Local" })).toBeVisible()
  })
})
