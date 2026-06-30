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
  const tree = page.getByRole("tree", { name: "Review model" })
  const alpha = page.getByRole("treeitem", { name: "Alpha" })
  const bravo = page.getByRole("treeitem", { name: "Bravo" })

  await expect(combobox).toBeFocused()
  await expect(combobox).toHaveAttribute("aria-expanded", "true")
  await expect(combobox).toHaveAttribute("aria-haspopup", "tree")
  await expect(combobox).toHaveAttribute("aria-controls", await tree.getAttribute("id"))
  await expect(combobox).toHaveAttribute("aria-activedescendant", await alpha.getAttribute("id"))
  await expect(combobox).toHaveAccessibleDescription("Choose the model used for code review tasks.")
  await expect(alpha.locator("button")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Add to favorites: Alpha" })).toBeVisible()
  await expect(page.locator(".model-selector-group-label").nth(0)).toContainText("Auto Models")
  await expect(page.locator(".model-selector-group-label").nth(1)).toContainText("Recommended")
  const auto = page.getByRole("treeitem", { name: /Kilo Auto Efficient/ })
  await expect(auto).toBeVisible()
  await expect(auto.locator(".model-selector-auto-icon")).toHaveAttribute(
    "aria-label",
    "Routes each request to the cheapest model that gets the job done, based on continuously benchmarked accuracy and cost.",
  )
  await expect(page.getByRole("treeitem", { name: "Omega" })).toBeVisible()

  await combobox.press("ArrowDown")
  await expect(combobox).toBeFocused()
  await expect(combobox).toHaveAttribute("aria-activedescendant", await bravo.getAttribute("id"))

  const collapse = page.getByRole("button", { name: "Collapse", exact: true })
  const controls = await collapse.getAttribute("aria-controls")
  const preview = page.locator(`[id="${controls}"]`)
  await expect(collapse).toHaveAttribute("aria-expanded", "true")
  await expect(preview).toHaveAttribute("aria-hidden", "false")
  await expect(preview.getByRole("button", { name: "Add to favorites" })).toBeVisible()
  const listBeforePreview = await tree.evaluate((el, id) => {
    const node = document.getElementById(id!)
    return !!node && !!(el.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
  }, controls)
  const treeBox = await tree.boundingBox()
  const previewBox = await preview.boundingBox()
  expect(listBeforePreview).toBe(true)
  expect(previewBox!.y).toBeLessThan(treeBox!.y)
  await collapse.click()
  const expand = page.getByRole("button", { name: "Expand" })
  await expect(expand).toHaveAttribute("aria-controls", controls!)
  await expect(expand).toHaveAttribute("aria-expanded", "false")
  await expect(preview).toHaveAttribute("aria-hidden", "true")
  await expect(preview.locator("button, a, [tabindex]")).toHaveCount(0)
})

test("auto efficient details show server description and model choices", async ({ page }) => {
  await load(page, "shared--model-selector-accessible")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  await page.getByRole("treeitem", { name: /Kilo Auto Efficient/ }).click()

  const preview = page.locator(".model-selector-preview")
  await expect(preview).toContainText(
    "Routes each request to the cheapest model that gets the job done, based on continuously benchmarked accuracy and cost.",
  )
  await expect(preview).toContainText("Model choices")
  await expect(preview).toContainText("google/gemini-2.5-flash")
  await expect(preview).toContainText("anthropic/claude-sonnet-4.6")
  await expect(preview).not.toContainText("openai/gpt-5.5")
})

test("typing a provider initial moves the active descendant to matching results", async ({ page }) => {
  await load(page, "shared--model-selector-accessible")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  const combobox = page.getByRole("combobox", { name: "Review model: Alpha. Search models" })
  await combobox.fill("N")

  const nova = page.getByRole("treeitem", { name: "Nova" })
  await expect(nova).toBeVisible()
  await expect(combobox).toHaveAttribute("aria-activedescendant", await nova.getAttribute("id"))
  await expect(page.getByRole("treeitem", { name: "NVIDIA" })).toHaveAttribute("aria-expanded", "true")
})

test("provider groups collapse, expand, and skip their model rows", async ({ page }) => {
  await load(page, "shared--model-selector-accessible")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  const combobox = page.getByRole("combobox", { name: "Review model: Alpha. Search models" })
  const kilo = page.getByRole("treeitem", { name: "Kilo", exact: true })
  const nvidia = page.getByRole("treeitem", { name: "NVIDIA" })

  await combobox.press("ArrowDown")
  await combobox.press("ArrowLeft")
  await expect(combobox).toHaveAttribute("aria-activedescendant", await kilo.getAttribute("id"))
  await combobox.press("ArrowLeft")
  await expect(kilo).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByRole("treeitem", { name: "Bravo" })).toBeHidden()

  await combobox.press("ArrowDown")
  await expect(combobox).toHaveAttribute("aria-activedescendant", await nvidia.getAttribute("id"))
  await combobox.press("ArrowLeft")
  await expect(nvidia).toHaveAttribute("aria-expanded", "false")
  await combobox.press("ArrowRight")
  await expect(nvidia).toHaveAttribute("aria-expanded", "true")
  await combobox.press("ArrowRight")
  await expect(combobox).toHaveAttribute(
    "aria-activedescendant",
    await page.getByRole("treeitem", { name: "Nemotron" }).getAttribute("id"),
  )
})

test("active descendant always identifies a visible tree item", async ({ page }) => {
  await load(page, "shared--model-selector-accessible")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  const combobox = page.getByRole("combobox", { name: "Review model: Alpha. Search models" })
  const active = async () => {
    await expect.poll(() => combobox.getAttribute("aria-activedescendant")).toBeTruthy()
    const id = await combobox.getAttribute("aria-activedescendant")
    await expect(page.locator(`[id="${id}"]`)).toBeVisible()
  }

  await active()
  await combobox.press("ArrowDown")
  await active()
  await combobox.press("ArrowLeft")
  await active()
  await combobox.press("ArrowRight")
  await active()
  await combobox.fill("N")
  await active()
  await combobox.press("ArrowLeft")
  await combobox.press("ArrowDown")
  await combobox.press("ArrowLeft")
  await active()
  await combobox.fill("no matching model")
  await active()
})

test("expanded preview waits for explicit pointer selection", async ({ page }) => {
  await load(page, "shared--model-selector-accessible")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  await expect(page.locator(".model-selector-preview")).toContainText("Alpha")
  await page.getByRole("treeitem", { name: "Bravo" }).hover()
  await page.waitForTimeout(250)
  await expect(page.locator(".model-selector-preview")).toContainText("Alpha")
  await page.getByRole("treeitem", { name: "Bravo" }).click()

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
  const alpha = page.getByRole("treeitem", { name: "Alpha" })
  const favorites = page.getByRole("treeitem", { name: "Favorites" })
  await expect(alpha.first()).toHaveAttribute("aria-selected", "true")
  await expect.poll(() => favorites.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("solid")

  await favorites.click()
  await expect(alpha).toHaveCount(1)
  await expect(alpha).toHaveAttribute("aria-selected", "true")
  await expect(combobox).toHaveAttribute("aria-activedescendant", await favorites.getAttribute("id"))
})

test("large catalogs keep the rendered tree bounded and navigate to distant models", async ({ page }) => {
  await load(page, "shared--model-selector-large-catalog")

  await page.getByRole("button", { name: "Select model: Provider 0 / Model 300" }).click()
  const combobox = page.getByRole("combobox", { name: "Select model: Provider 0 / Model 300. Search models" })
  const tree = page.getByRole("tree", { name: "Select model" })

  // The window mounts before we measure it, yet stays far smaller than the catalog.
  await expect.poll(() => tree.getByRole("treeitem").count()).toBeGreaterThan(0)
  await expect.poll(() => tree.getByRole("treeitem").count()).toBeLessThan(50)

  // Reaching a distant model scrolls it into the mounted window and activates it.
  await combobox.fill("Model 599")
  const last = page.getByRole("treeitem", { name: "Model 599" })
  await expect(last).toBeVisible()
  await expect(combobox).toHaveAttribute("aria-activedescendant", await last.getAttribute("id"))
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
  const clear = page.getByRole("treeitem", { name: "Use default model" })
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

  await load(page, "settings--models-speech-to-text")
  const speech = page.getByRole("button", { name: "Speech to Text Model: Chirp 3" })
  await expect(speech).toBeEnabled()
  await speech.click()
  await page.getByRole("option", { name: "Parakeet TDT 0.6B v3 (NVIDIA)" }).click()
  await expect(page.getByRole("button", { name: "Speech to Text Model: Parakeet TDT 0.6B v3" })).toBeVisible()

  await load(page, "settings--mode-edit-export")
  await expect(page.getByRole("button", { name: /Model Override:/ })).toHaveAccessibleDescription(
    "Override the default model for this agent",
  )
})

test("mode picker focuses the selected mode as it opens", async ({ page }) => {
  await load(page, "prompt-input--default-420")

  await page.getByRole("button", { name: "Code", exact: true }).click()
  await expect(page.locator(".mode-switcher-item.selected")).toBeFocused()
})

test("variant picker focuses the selected effort as it opens", async ({ page }) => {
  await load(page, "prompt-input--with-thinking-420")

  await page.getByRole("button", { name: "Medium", exact: true }).click()
  await expect(page.locator(".thinking-selector-item.selected")).toBeFocused()
})

test("slash mode picker Escape returns focus to the prompt", async ({ page }) => {
  await load(page, "prompt-input--default-420")

  const prompt = page.locator("textarea.prompt-input")
  await prompt.evaluate((el) => el.setAttribute("aria-disabled", "false"))
  await prompt.fill("/agents")
  await prompt.press("Enter")

  const selected = page.locator(".mode-switcher-item.selected")
  await expect(selected).toBeFocused()
  await selected.press("Escape")

  await expect(prompt).toBeFocused()
})

test("chat picker Escape returns focus to the prompt", async ({ page }) => {
  await load(page, "prompt-input--default-420")

  await page.getByRole("button", { name: /^Select model:/ }).click()
  const combobox = page.getByRole("combobox", { name: /^Select model:.*Search models$/ })
  await expect(combobox).toBeFocused()
  await combobox.press("Escape")

  await expect(page.locator("textarea.prompt-input")).toBeFocused()
})

test("slash model picker Escape returns focus to the prompt", async ({ page }) => {
  await load(page, "prompt-input--default-420")

  const prompt = page.locator("textarea.prompt-input")
  await prompt.evaluate((el) => el.setAttribute("aria-disabled", "false"))
  await prompt.fill("/model")
  await prompt.press("Enter")
  const combobox = page.getByRole("combobox", { name: /^Select model:.*Search models$/ })
  await expect(combobox).toBeFocused()
  await combobox.press("Escape")

  await expect(prompt).toBeFocused()
})
