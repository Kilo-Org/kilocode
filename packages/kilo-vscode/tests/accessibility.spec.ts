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
  { id: "marketplace--empty-list", name: "Marketplace / empty state" },
  { id: "agentmanager--sidebar-search-open", name: "Agent Manager / sidebar search" },
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

  test("Agent Manager keeps virtualized transcript fragments laid out", async ({ page }) => {
    await open(page, "agentmanager--sidebar-search-open")

    const visibility = await page.locator("#storybook-root").evaluate((root) => {
      const layout = document.createElement("div")
      layout.className = "am-layout"
      root.append(layout)
      const names = ["assistant-message", "tool-trigger", "file", "code", "diff"]
      const values = names.map((name) => {
        const node = document.createElement("div")
        node.dataset.component = name
        layout.append(node)
        return getComputedStyle(node).contentVisibility
      })
      layout.remove()
      return values
    })

    expect(visibility).toEqual(["visible", "visible", "visible", "visible", "visible"])
  })

  test("Agent Manager avoids generated separator text in updating tool rows", async ({ page }) => {
    await open(page, "agentmanager--sidebar-search-open")

    const content = await page.locator("#storybook-root").evaluate((root) => {
      const layout = document.createElement("div")
      layout.className = "am-layout"
      const wrapper = document.createElement("div")
      wrapper.dataset.component = "tool-part-wrapper"
      wrapper.dataset.partType = "tool"
      const collapsible = document.createElement("div")
      collapsible.className = "tool-collapsible"
      collapsible.dataset.component = "collapsible"
      const title = document.createElement("span")
      title.dataset.slot = "basic-tool-tool-title"
      const subtitle = document.createElement("span")
      subtitle.dataset.slot = "basic-tool-tool-subtitle"
      collapsible.append(title, subtitle)
      wrapper.append(collapsible)
      layout.append(wrapper)
      root.append(layout)
      const value = getComputedStyle(subtitle, "::before").content
      layout.remove()
      return value
    })

    expect(content).toBe("none")
  })

  test("sidebar keeps transcript announcements while Agent Manager bounds them", async ({ page }) => {
    await open(page, "chat--chat-view-with-messages")
    await expect(page.locator(".message-list")).toHaveAttribute("role", "log")
    await expect(page.locator(".message-list")).toHaveAttribute("aria-live", "polite")

    await open(page, "chat--chat-view-agent-manager-completed")
    await expect(page.locator(".message-list")).not.toHaveAttribute("role")
    await expect(page.locator(".message-list")).not.toHaveAttribute("aria-live")
    await expect(page.locator('.sr-only[role="status"]')).toHaveAttribute("aria-live", "polite")
  })

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

  test("Agent Manager sidebar search filters and selects with the keyboard", async ({ page }) => {
    await open(page, "agentmanager--sidebar-search-open")

    const trigger = page.getByRole("button", { name: "Search worktrees and sessions" })
    const input = page.getByPlaceholder("Search worktrees and sessions", { exact: true })
    const prompt = page.getByRole("textbox", { name: "Story prompt" })
    await expect(input).toBeFocused()
    await expect(page.locator('[data-slot="list-header"]')).toHaveText(["SESSIONS", "LOCAL & WORKTREES"])

    await input.fill("Render")
    await expect(page.locator('[data-slot="sidebar-search-result"]').first()).toContainText(
      "Render images in diff viewer",
    )
    await input.fill("rndr img")
    await expect(page.locator('[data-slot="sidebar-search-result"]').first()).toContainText(
      "Render images in diff viewer",
    )

    await input.fill("main")
    await expect(page.locator('[data-slot="sidebar-search-result"]').first()).toContainText("local")
    await page.keyboard.press("Enter")
    await expect(page.locator('[data-slot="sidebar-search-selection"]')).toHaveText("local")
    await expect(prompt).toBeFocused()

    await trigger.click()
    await input.fill("Build grouped")
    await expect(page.getByText("Build grouped worktree search", { exact: true })).toBeVisible()

    await page.keyboard.press("Enter")
    await expect(page.locator('[data-slot="sidebar-search-selection"]')).toHaveText("session:session-build")
    await expect(input).toBeHidden()
    await expect(prompt).toBeFocused()

    await trigger.click()
    await input.fill("local indexing")
    await expect(page.getByText("Investigate local indexing", { exact: true })).toBeVisible()
    await page.keyboard.press("Enter")
    await expect(page.locator('[data-slot="sidebar-search-selection"]')).toHaveText("session:session-local")

    await trigger.click()
    await input.fill("does not exist")
    await expect(page.locator('[data-slot="list-empty-state"]')).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(prompt).toBeFocused()

    await trigger.click()
    await expect(input).toBeFocused()
    await page.locator(".am-section-label").click()
    await expect(prompt).toBeFocused()

    await trigger.hover()
    await expect(
      page.getByText("Searches the local workspace, local sessions, worktrees, and their sessions", { exact: true }),
    ).toBeVisible()
    await expect(page.getByText("⌘F", { exact: true })).toBeVisible()
  })
})
