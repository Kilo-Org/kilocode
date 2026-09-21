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

async function selectChipWithTrailingSpace(page: Page) {
  await page.evaluate(() => {
    const field = document.querySelector("textarea.prompt-input") as HTMLTextAreaElement
    const end = field.value.indexOf("]") + 1
    field.focus()
    field.setSelectionRange(0, field.value[end] === " " ? end + 1 : end)
  })
}

test("keeps the surviving backing when a chip is deleted together with the space after it", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  const input = await open(page)
  const first = block("a")
  const second = block("b")

  await paste(page, input, first)
  await paste(page, input, second)
  await expect(page.locator(".prompt-input-paste")).toHaveCount(2)

  // Both chips carry the same label, so the resulting text alone cannot say
  // which one was removed; the span the edit reports has to settle it.
  await selectChipWithTrailingSpace(page)
  await input.press("Delete")

  await expect(page.locator(".prompt-input-paste")).toHaveCount(1)
  await expect(input).toHaveValue(PLACEHOLDER)
  await clickChip(page)
  await expect(input).toHaveValue(second)
})

test("keeps the surviving backing when the two chips carry different line counts", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  const input = await open(page)
  const first = block("a")
  const tall = Array.from({ length: 20 }, (_, index) => `b${index} ${"x".repeat(40)}`).join("\n")

  await paste(page, input, first)
  await paste(page, input, tall)
  await expect(page.locator(".prompt-input-paste")).toHaveCount(2)

  await selectChipWithTrailingSpace(page)
  await input.press("Delete")

  await expect(page.locator(".prompt-input-paste")).toHaveCount(1)
  await expect(input).toHaveValue("[Pasted ~20 lines]")
  await clickChip(page)
  await expect(input).toHaveValue(tall)
})

test("keeps the surviving backing when the space and the second chip go together", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  const input = await open(page)
  const first = block("a")
  const second = block("b")

  await paste(page, input, first)
  await paste(page, input, second)
  await expect(page.locator(".prompt-input-paste")).toHaveCount(2)

  await page.evaluate(() => {
    const field = document.querySelector("textarea.prompt-input") as HTMLTextAreaElement
    field.focus()
    field.setSelectionRange(field.value.indexOf("]") + 1, field.value.length)
  })
  await input.press("Delete")

  await expect(page.locator(".prompt-input-paste")).toHaveCount(1)
  await expect(input).toHaveValue(PLACEHOLDER)
  await clickChip(page)
  await expect(input).toHaveValue(first)
})

test("drops both chips when a selection covering them both is typed over", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  const input = await open(page)

  await paste(page, input, block("a"))
  await paste(page, input, block("b"))
  await expect(page.locator(".prompt-input-paste")).toHaveCount(2)

  await input.press("ControlOrMeta+A")
  await input.pressSequentially("z")

  await expect(page.locator(".prompt-input-paste")).toHaveCount(0)
  await expect(input).toHaveValue("z")
})

test("keeps both chips when text is typed between them", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  const input = await open(page)
  const first = block("a")
  const second = block("b")

  await paste(page, input, first)
  await paste(page, input, second)

  // A caret carries no span, so this goes through the diff; both chips survive.
  await page.evaluate(() => {
    const field = document.querySelector("textarea.prompt-input") as HTMLTextAreaElement
    const at = field.value.indexOf("]") + 2
    field.focus()
    field.setSelectionRange(at, at)
  })
  await input.pressSequentially("h")

  await expect(page.locator(".prompt-input-paste")).toHaveCount(2)
  await expect(input).toHaveValue(`${PLACEHOLDER} h${PLACEHOLDER}`)
  await clickChip(page, 1)
  await expect(input).toHaveValue(`${PLACEHOLDER} h${second}`)
})

test("keeps both chips when a rewrite follows an edit that left the text unchanged", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  const input = await open(page)
  const first = block("a")
  const second = block("b")

  await paste(page, input, first)
  await paste(page, input, second)
  await expect(page.locator(".prompt-input-paste")).toHaveCount(2)

  // This moves no text, so nothing reconciles and the span is still in hand.
  await page.evaluate(() => {
    const field = document.querySelector("textarea.prompt-input") as HTMLTextAreaElement
    field.focus()
    field.setSelectionRange(field.value.length - 1, field.value.length)
  })
  await input.pressSequentially("]")
  await expect(input).toHaveValue(`${PLACEHOLDER} ${PLACEHOLDER}`)

  // A rewrite with no span of its own, the way an accepted ghost completion appends.
  await page.evaluate(() => {
    const field = document.querySelector("textarea.prompt-input") as HTMLTextAreaElement
    field.value = `${field.value}!`
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })

  await expect(page.locator(".prompt-input-paste")).toHaveCount(2)
  await clickChip(page, 1)
  await expect(input).toHaveValue(`${PLACEHOLDER} ${second}!`)
})
