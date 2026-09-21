import { expect, test, type Page } from "@playwright/test"
import { open } from "./helpers/prompt-input"

const PLACEHOLDER = "[Pasted ~15 lines]"

function block(tag: string) {
  return Array.from({ length: 15 }, (_, index) => `${tag}${index} ${"x".repeat(40)}`).join("\n")
}

async function paste(page: Page, input: ReturnType<Page["locator"]>, text: string) {
  await page.evaluate(async (value) => navigator.clipboard.writeText(value), text)
  await input.focus()
  await page.keyboard.press("ControlOrMeta+V")
}

async function clickChip(page: Page, index = 0) {
  await page.evaluate((at) => (document.querySelectorAll(".prompt-input-paste")[at] as HTMLElement).click(), index)
}

test("keeps the surviving paste chip and its backing after deleting an earlier chip", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  const input = await open(page)
  const first = block("a")
  const second = block("b")

  await paste(page, input, first)
  await paste(page, input, second)
  await expect(page.locator(".prompt-input-paste")).toHaveCount(2)

  // Delete the first chip from the caret at its end.
  await page.evaluate(() => {
    const field = document.querySelector("textarea.prompt-input") as HTMLTextAreaElement
    const end = field.value.indexOf("[Pasted ~15 lines]") + "[Pasted ~15 lines]".length
    field.focus()
    field.setSelectionRange(end, end)
  })
  await input.press("Backspace")

  // The edit must shift the remaining range once, so it stays a chip.
  await expect(page.locator(".prompt-input-paste")).toHaveCount(1)
  await expect(input).toHaveValue(PLACEHOLDER)

  // And it must keep the second block's backing, not the deleted one's.
  await clickChip(page)
  await expect(input).toHaveValue(second)
})
