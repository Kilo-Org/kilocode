import { test, expect } from "./fixtures"
import { promptSelector } from "./utils"

test("smoke model selection updates prompt footer", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.locator(promptSelector).click()
  await page.keyboard.type("/model")

  const command = page.locator('[data-slash-id="model.choose"]')
  await expect(command).toBeVisible()
  await command.hover()

  await page.keyboard.press("Enter")

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()

  const input = dialog.getByRole("textbox").first()

  // Wait for list items to be visible (there may or may not be a selected one depending on provider config)
  const listItems = dialog.locator('[data-slot="list-item"]')
  await expect(listItems.first()).toBeVisible()

  // Try to find a selected item, otherwise use the first available item
  const selected = dialog.locator('[data-slot="list-item"][data-selected="true"]').first()
  const hasSelected = (await selected.count()) > 0
  const target = hasSelected ? selected : listItems.first()

  const key = await target.getAttribute("data-key")
  if (!key) throw new Error("Failed to resolve model key from list item")

  const name = (await target.locator("span").first().innerText()).trim()
  const model = key.split(":").slice(1).join(":")

  await input.fill(model)

  const item = dialog.locator(`[data-slot="list-item"][data-key="${key}"]`)
  await expect(item).toBeVisible()
  await item.click()

  await expect(dialog).toHaveCount(0)

  const form = page.locator(promptSelector).locator("xpath=ancestor::form[1]")
  await expect(form.locator('[data-component="button"]').filter({ hasText: name }).first()).toBeVisible()
})
