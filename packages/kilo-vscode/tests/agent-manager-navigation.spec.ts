import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

function story(page: Page, id: string) {
  return page.goto(`/iframe.html?id=${id}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
}

test.describe("Agent Manager accessible navigation", () => {
  test("selects worktrees and operates section disclosure from the keyboard", async ({ page }) => {
    await story(page, "agentmanager-navigation--worktrees-keyboard")

    const section = page.getByRole("button", { name: /Accessibility fixes/ })
    await expect(section).toHaveAttribute("aria-expanded", "true")
    await section.focus()
    await page.keyboard.press("Space")
    await expect(section).toHaveAttribute("aria-expanded", "false")
    await expect(page.locator(".am-worktree-item")).toHaveCount(0)

    await section.press("Enter")
    const first = page.getByRole("button", { name: "Keyboard navigation", exact: true })
    const second = page.getByRole("button", { name: "Screen reader navigation", exact: true })
    await expect(first).toHaveAttribute("aria-current", "page")
    await expect(second).not.toHaveAttribute("aria-current", "page")

    await second.focus()
    await second.press("Space")
    await expect(second).toHaveAttribute("aria-current", "page")
    await expect(page.getByTestId("worktree-state")).toContainText("wt-reader")

    await first.press("Enter")
    await second.focus()
    const remove = page.getByRole("button", { name: "Delete worktree: Screen reader navigation" })
    await expect(remove).toBeVisible()
    await remove.press("Enter")
    await expect(page.getByTestId("worktree-state")).toContainText("wt-keyboard|wt-reader")
  })

  test("switches and safely closes session, review, and terminal tabs", async ({ page }) => {
    await story(page, "agentmanager-navigation--tabs-keyboard")

    const list = page.getByRole("tablist", { name: "Open tabs" })
    const session = page.getByRole("tab", { name: "Implement navigation" })
    const review = page.getByRole("tab", { name: "Review" })
    const terminal = page.getByRole("tab", { name: "Shell" })
    await expect(list).toHaveAttribute("aria-orientation", "horizontal")
    await expect(session).toHaveAttribute("aria-selected", "true")
    await expect(session).toHaveAttribute("tabindex", "0")

    await session.focus()
    await session.press("ArrowRight")
    await expect(review).toBeFocused()
    await expect(review).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "am-tab-review")

    await review.press("ArrowRight")
    await expect(terminal).toBeFocused()
    await expect(terminal).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tabpanel")).toHaveAttribute("id", "am-panel-terminal%3Afixture")

    await terminal.press("Home")
    await expect(session).toBeFocused()
    await session.press("Space")
    await expect(session).toHaveAttribute("aria-selected", "true")

    await page.locator(".am-tab-review").click({ position: { x: 2, y: 10 } })
    await expect(review).toHaveAttribute("aria-selected", "true")
    await page.locator(".am-tab-terminal").click({ position: { x: 2, y: 10 } })
    await expect(terminal).toHaveAttribute("aria-selected", "true")
    await page
      .locator(".am-tab")
      .first()
      .click({ position: { x: 2, y: 10 } })
    await expect(session).toHaveAttribute("aria-selected", "true")

    const closeSession = page.getByRole("button", { name: "Close tab: Implement navigation" })
    const closeReview = page.getByRole("button", { name: "Close tab: Review" })
    const closeTerminal = page.getByRole("button", { name: "Close tab: Shell" })
    await expect(closeSession).toHaveAttribute("tabindex", "0")
    await closeSession.focus()
    await closeSession.press("Enter")
    await expect(session).toHaveCount(0)
    await expect(review).toBeFocused()
    await expect(review).toHaveAttribute("aria-selected", "true")

    await closeReview.focus()
    await closeReview.press("Enter")
    await expect(review).toHaveCount(0)
    await expect(terminal).toBeFocused()
    await expect(terminal).toHaveAttribute("aria-selected", "true")

    await closeTerminal.press("Enter")
    await expect(terminal).toHaveCount(0)
    await expect(list.getByRole("tab")).toHaveCount(0)
  })
})
