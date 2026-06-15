import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

function story(id: string) {
  return `/iframe.html?id=${id}&viewMode=story&globals=${GLOBALS}`
}

async function load(page: Page, id: string) {
  await page.goto(story(id), { waitUntil: "load" })
  await page.waitForSelector("#storybook-root *", { state: "attached" })
}

test("model selector exposes combobox relationships and active option movement", async ({ page }) => {
  await load(page, "shared--model-selector-accessible")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  const combobox = page.getByRole("combobox", { name: "Review model: Alpha. Search models" })
  const listbox = page.getByRole("listbox", { name: "Review model" })
  const alpha = page.getByRole("option", { name: "Alpha" })
  const bravo = page.getByRole("option", { name: "Bravo" })

  await expect(combobox).toBeFocused()
  await expect(combobox).toHaveAttribute("aria-expanded", "true")
  await expect(combobox).toHaveAttribute("aria-controls", await listbox.getAttribute("id"))
  await expect(combobox).toHaveAttribute("aria-activedescendant", await alpha.getAttribute("id"))
  await expect(combobox).toHaveAccessibleDescription("Choose the model used for code review tasks.")
  await expect(alpha.locator("button")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Add to favorites: Alpha" })).toBeVisible()

  await combobox.press("ArrowDown")
  await expect(combobox).toBeFocused()
  await expect(combobox).toHaveAttribute("aria-activedescendant", await bravo.getAttribute("id"))

  const expand = page.getByRole("button", { name: "Expand" })
  const controls = await expand.getAttribute("aria-controls")
  const preview = page.locator(`[id="${controls}"]`)
  await expect(expand).toHaveAttribute("aria-expanded", "false")
  await expect(preview).toHaveAttribute("aria-hidden", "true")
  await expect(preview.locator("button, a, [tabindex]")).toHaveCount(0)
  await expand.click()
  const collapse = page.getByRole("button", { name: "Collapse", exact: true })
  await expect(collapse).toHaveAttribute("aria-controls", controls!)
  await expect(collapse).toHaveAttribute("aria-expanded", "true")
  await expect(preview).toHaveAttribute("aria-hidden", "false")
  await expect(preview.getByRole("button", { name: "Add to favorites" })).toBeVisible()
})

test("expanded preview waits for explicit pointer selection", async ({ page }) => {
  await load(page, "shared--model-selector-accessible")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  await page.getByRole("button", { name: "Expand" }).click()
  await page.getByRole("option", { name: "Bravo" }).click()

  await expect(page.getByTestId("model-selector-value")).toHaveText("alpha")
  await expect(page.getByRole("combobox", { name: "Review model: Alpha. Search models" })).toBeVisible()
  await expect(page.locator(".model-selector-preview")).toContainText("Bravo")

  await page.getByRole("button", { name: "Select: Bravo" }).click()
  await expect(page.getByTestId("model-selector-value")).toHaveText("bravo")
})

test("selected favorite remains selected when its duplicate group is collapsed", async ({ page }) => {
  await load(page, "shared--model-selector-selected-favorite")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  const combobox = page.getByRole("combobox", { name: "Review model: Alpha. Search models" })
  const alpha = page.getByRole("option", { name: "Alpha" })
  const favorites = page.getByRole("button", { name: "Collapse Favorites" })
  await expect(alpha.first()).toHaveAttribute("aria-selected", "true")
  await expect.poll(() => favorites.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("solid")

  await favorites.click()
  await expect(alpha).toHaveCount(1)
  await expect(alpha).toHaveAttribute("aria-selected", "true")
  await expect(combobox).toHaveAttribute("aria-activedescendant", await alpha.getAttribute("id"))
})

test("Enter selects the active option and Escape restores selector focus", async ({ page }) => {
  await load(page, "shared--model-selector-accessible")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  const combobox = page.getByRole("combobox", { name: "Review model: Alpha. Search models" })
  await combobox.press("ArrowDown")
  await combobox.press("Enter")

  const trigger = page.getByRole("button", { name: "Review model: Bravo" })
  await expect(page.getByTestId("model-selector-value")).toHaveText("bravo")
  await expect(trigger).toBeFocused()

  await trigger.click()
  const reopened = page.getByRole("combobox", { name: "Review model: Bravo. Search models" })
  await reopened.press("ArrowDown")
  await reopened.press("Escape")

  await expect(page.getByTestId("model-selector-value")).toHaveText("bravo")
  await expect(trigger).toBeFocused()
})

test("no-match search announces the empty result and can choose the default option", async ({ page }) => {
  await load(page, "shared--model-selector-accessible")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  const combobox = page.getByRole("combobox", { name: "Review model: Alpha. Search models" })
  await combobox.fill("no matching model")

  await expect(page.locator(".model-selector-empty")).toHaveText("No model results")
  const clear = page.getByRole("option", { name: "Use default model" })
  await expect(combobox).toHaveAttribute("aria-activedescendant", await clear.getAttribute("id"))
  await combobox.press("Enter")

  await expect(page.getByTestId("model-selector-value")).toHaveText("default")
  await expect(page.getByRole("button", { name: "Review model: Use default model" })).toBeFocused()
})

test("settings and mode editing expose distinct model field purposes", async ({ page }) => {
  await load(page, "settings--models-accessible-labels")

  await expect(page.getByRole("button", { name: "Default Model: Not set" })).toHaveAccessibleDescription(
    "Primary model for conversations",
  )
  await expect(page.getByRole("button", { name: "Small Model: Not set" })).toHaveAccessibleDescription(
    /Lightweight model/,
  )
  await expect(page.getByRole("button", { name: "Subagent Model: Not set" })).toHaveAccessibleDescription(
    /Default model and reasoning effort/,
  )
  await expect(page.getByRole("button", { name: "Autocomplete model: Not set" })).toHaveAccessibleDescription(
    "Select the model used for inline code completions",
  )
  await expect(page.getByRole("button", { name: "Model per Mode: code: Not set" })).toHaveAccessibleDescription(
    /Override the default model for specific modes/,
  )

  await load(page, "settings--mode-edit-export")
  await expect(page.getByRole("button", { name: /Model Override:/ })).toHaveAccessibleDescription(
    "Override the default model for this agent",
  )
})

test("chat picker Escape returns focus to the prompt", async ({ page }) => {
  await load(page, "prompt-input--default-420")

  await page.getByRole("button", { name: /^Select model:/ }).click()
  const combobox = page.getByRole("combobox", { name: /^Select model:.*Search models$/ })
  await expect(combobox).toBeFocused()
  await combobox.press("Escape")

  await expect(page.locator("textarea.prompt-input")).toBeFocused()
})
