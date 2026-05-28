import { expect, test, type Locator, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const STORY_ID = "prompt-input--suggestions"

function storyUrl() {
  return `/iframe.html?id=${STORY_ID}&viewMode=story&globals=${GLOBALS}`
}

async function load(page: Page): Promise<Locator> {
  await page.goto(storyUrl(), { waitUntil: "load" })
  await page.waitForSelector("#storybook-root *", { state: "attached" })
  const prompt = page.getByRole("combobox", { name: "Chat prompt" })
  await expect(prompt).toBeVisible()
  return prompt
}

async function message(page: Page, data: unknown) {
  await page.evaluate((value) => window.postMessage(value, "*"), data)
}

test("prompt retains a stable accessible name after text is entered", async ({ page }) => {
  const prompt = await load(page)

  await prompt.fill("Explain this file")

  await expect(page.getByRole("combobox", { name: "Chat prompt" })).toHaveValue("Explain this file")
  await expect(prompt).toHaveAttribute("aria-autocomplete", "list")
  await expect(prompt).toHaveAttribute("aria-expanded", "false")
})

test("file mention suggestions expose active traversal and selection", async ({ page }) => {
  const prompt = await load(page)

  await prompt.fill("@ax")
  await page.waitForTimeout(180)
  await message(page, {
    type: "fileSearchResult",
    requestId: "file-search-1",
    dir: "/project",
    paths: ["src/ax-one.ts", "src/ax-two.ts"],
    items: [
      { path: "src/ax-one.ts", type: "file" },
      { path: "src/ax-two.ts", type: "file" },
    ],
  })

  const list = page.getByRole("listbox", { name: "File mention suggestions" })
  const options = list.getByRole("option")
  await expect(list).toBeVisible()
  await expect(options).toHaveCount(2)
  const id = await list.getAttribute("id")
  expect(id).not.toBeNull()
  await expect(prompt).toHaveAttribute("aria-expanded", "true")
  await expect(prompt).toHaveAttribute("aria-controls", id ?? "")
  await expect(prompt).toHaveAttribute("aria-activedescendant", (await options.nth(0).getAttribute("id")) ?? "")
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true")

  await prompt.press("ArrowDown")
  await expect(prompt).toHaveAttribute("aria-activedescendant", (await options.nth(1).getAttribute("id")) ?? "")
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true")

  await prompt.press("Enter")
  await expect(prompt).toHaveValue("@src/ax-two.ts ")
  await expect(prompt).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByTestId("prompt-status")).toHaveText("Selected mention @src/ax-two.ts")
})

test("file mention suggestions announce an empty result set", async ({ page }) => {
  const prompt = await load(page)

  await prompt.fill("@zzqx")

  const list = page.getByRole("listbox", { name: "File mention suggestions" })
  await expect(prompt).toHaveAttribute("aria-expanded", "true")
  await expect(list.locator(".file-mention-empty")).toHaveText("Loading")
  await expect(page.getByTestId("prompt-status")).toHaveText("Loading")
  await page.waitForTimeout(180)
  await message(page, {
    type: "fileSearchResult",
    requestId: "file-search-1",
    dir: "/project",
    paths: [],
    items: [],
  })
  await expect(list.locator(".file-mention-empty")).toHaveText("No matching results")
  await expect(page.getByTestId("prompt-status")).toHaveText("No matching results")
  await expect(prompt).not.toHaveAttribute("aria-activedescendant")
})

test("slash command suggestions expose active traversal and inserted selection", async ({ page }) => {
  const prompt = await load(page)
  await prompt.fill("/alpha-")

  const list = page.getByRole("listbox", { name: "Command suggestions" })
  const options = list.getByRole("option")
  await expect(list.locator(".slash-command-empty")).toHaveText("Loading")
  await prompt.press("ArrowDown")
  await message(page, {
    type: "commandsLoaded",
    commands: [
      { name: "alpha-one", description: "First command", hints: [] },
      { name: "alpha-two", description: "Second command", hints: [] },
    ],
  })

  await expect(list).toBeVisible()
  await expect(options).toHaveCount(2)
  const id = await list.getAttribute("id")
  expect(id).not.toBeNull()
  await expect(prompt).toHaveAttribute("aria-expanded", "true")
  await expect(prompt).toHaveAttribute("aria-controls", id ?? "")
  await expect(prompt).toHaveAttribute("aria-activedescendant", (await options.nth(0).getAttribute("id")) ?? "")
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true")

  await prompt.press("ArrowDown")
  await expect(prompt).toHaveAttribute("aria-activedescendant", (await options.nth(1).getAttribute("id")) ?? "")
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true")

  await prompt.press("Enter")
  await expect(prompt).toHaveValue("/alpha-two ")
  await expect(prompt).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByTestId("prompt-status")).toHaveText("Selected command /alpha-two")
})

test("slash command suggestions announce an empty result set", async ({ page }) => {
  const prompt = await load(page)

  await prompt.fill("/zzqx")

  const list = page.getByRole("listbox", { name: "Command suggestions" })
  await expect(prompt).toHaveAttribute("aria-expanded", "true")
  await expect(list.locator(".slash-command-empty")).toHaveText("Loading")
  await expect(page.getByTestId("prompt-status")).toHaveText("Loading")
  await message(page, { type: "commandsLoaded", commands: [] })
  await expect(list.locator(".slash-command-empty")).toHaveText("No matching commands")
  await expect(page.getByTestId("prompt-status")).toHaveText("No matching commands")
  await expect(prompt).not.toHaveAttribute("aria-activedescendant")
})
