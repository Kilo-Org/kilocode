import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Locator, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const RULES = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]

// Explicitly ratchet in repaired/stable workflows rather than making existing
// untriaged Storybook findings block unrelated webview changes.
const STORIES = [
  { id: "profile--not-logged-in", name: "Profile / not logged in" },
  { id: "profile--logged-in-personal", name: "Profile / personal account" },
  { id: "profile--logged-in", name: "Profile / organization account" },
  { id: "settings--providers-configure", name: "Settings / providers empty state" },
  { id: "marketplace--skills-tab-empty", name: "Marketplace / skills empty state" },
  { id: "marketplace--agents-tab-empty", name: "Marketplace / agents empty state" },
]

function url(id: string) {
  return `/iframe.html?id=${id}&viewMode=story&globals=${GLOBALS}`
}

async function open(page: Page, id: string) {
  await page.goto(url(id), { waitUntil: "load" })
  await page.waitForSelector("#storybook-root *", { state: "attached" })
}

async function scan(page: Page) {
  const result = await new AxeBuilder({ page }).include("#storybook-root").withTags(RULES).analyze()
  const details = result.violations
    .map((item) => `${item.id}: ${item.help}\n${item.nodes.map((node) => `  ${node.target.join(" ")}`).join("\n")}`)
    .join("\n")

  expect(result.violations, details).toEqual([])
}

async function reach(page: Page, target: Locator) {
  for (let step = 0; step < 10; step++) {
    await page.keyboard.press("Tab")
    if (await target.evaluate((node) => node === document.activeElement)) return
  }
}

test.describe("webview accessibility ratchet", () => {
  for (const story of STORIES) {
    test(`${story.name} passes automated WCAG checks`, async ({ page }) => {
      await open(page, story.id)
      await scan(page)
    })
  }

  test("Profile login exposes a keyboard-operable named control", async ({ page }) => {
    await open(page, "profile--not-logged-in")

    const login = page.getByRole("button", { name: "Login with Kilo Code" })
    await reach(page, login)
    await expect(login).toBeFocused()

    await login.evaluate((node) => {
      node.addEventListener("click", () => node.setAttribute("data-keyboard-activated", "true"), { once: true })
    })
    await page.keyboard.press("Enter")
    await expect(login).toHaveAttribute("data-keyboard-activated", "true")
  })
})
