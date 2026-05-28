import { expect, test } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const HOST = process.env["STORYBOOK_URL"] ?? ""

function story(id: string) {
  return `${HOST}/iframe.html?id=${id}&viewMode=story&globals=${GLOBALS}`
}

test.describe("QuestionDock accessibility interactions", () => {
  test("exposes single-choice radio state and keyboard selection", async ({ page }) => {
    await page.goto(story("chat--question-dock-single"), { waitUntil: "load" })

    const group = page.getByRole("radiogroup", { name: "Which testing framework should I use for this project?" })
    const vitest = page.getByRole("radio", { name: "Vitest" })
    const jest = page.getByRole("radio", { name: "Jest" })

    await expect(group).toHaveAccessibleDescription("Select one answer")
    await expect(vitest).toHaveAccessibleDescription("Fast, Vite-native unit testing")
    await expect(vitest).toHaveAttribute("aria-checked", "false")
    await expect(vitest).toBeFocused()

    await vitest.click()
    await expect(vitest).toHaveAttribute("aria-checked", "true")
    await vitest.press("ArrowRight")
    await expect(jest).toBeFocused()
    await expect(vitest).toHaveAttribute("aria-checked", "false")
    await expect(jest).toHaveAttribute("aria-checked", "true")
  })

  test("selects the custom radio when reached with arrow navigation", async ({ page }) => {
    await page.goto(story("chat--question-dock-single"), { waitUntil: "load" })

    const bun = page.getByRole("radio", { name: "Bun test" })
    const custom = page.getByRole("radio", { name: "Type your own answer" })
    await bun.click()
    await expect(bun).toHaveAttribute("aria-checked", "true")

    await bun.press("ArrowRight")
    await expect(bun).toHaveAttribute("aria-checked", "false")
    await expect(custom).toHaveAttribute("aria-checked", "true")
    await expect(page.getByRole("textbox", { name: "Type your own answer" })).toBeFocused()
  })

  test("does not advance a question step while navigating radio answers", async ({ page }) => {
    await page.goto(story("chat--question-dock-multi"), { waitUntil: "load" })

    const group = page.getByRole("radiogroup", { name: "Which testing framework?" })
    const vitest = page.getByRole("radio", { name: "Vitest" })
    const jest = page.getByRole("radio", { name: "Jest" })

    await expect(vitest).toBeFocused()
    await vitest.press("ArrowRight")
    await expect(group).toBeVisible()
    await expect(jest).toBeFocused()
    await expect(jest).toHaveAttribute("aria-checked", "true")

    await jest.press("Enter")
    await expect(page.getByRole("radiogroup", { name: "Should I include coverage reporting?" })).toBeVisible()
  })

  test("exposes checkbox state and labels a submitted custom answer", async ({ page }) => {
    await page.goto(story("chat--question-dock-multiple-choice"), { waitUntil: "load" })

    const group = page.getByRole("group", { name: "Which checks should I run before submitting?" })
    const typecheck = page.getByRole("checkbox", { name: "Typecheck" })
    const lint = page.getByRole("checkbox", { name: "Lint" })
    const custom = page.getByRole("checkbox", { name: "Type your own answer" })

    await expect(group).toHaveAccessibleDescription("Select all answers that apply")
    await typecheck.click()
    await lint.click()
    await expect(typecheck).toHaveAttribute("aria-checked", "true")
    await expect(lint).toHaveAttribute("aria-checked", "true")

    await custom.click()
    const input = page.getByRole("textbox", { name: "Type your own answer" })
    await expect(input).toBeFocused()
    await input.fill("Compile extension")
    await input.press("Enter")
    await expect(custom).toHaveAttribute("aria-checked", "true")
    await expect(custom).toHaveAccessibleDescription("Compile extension")
  })

  test("exposes and keyboard-operates the question disclosure", async ({ page }) => {
    await page.goto(story("chat--question-dock-single"), { waitUntil: "load" })

    const toggle = page.locator('[data-slot="question-collapse-toggle"]')
    const body = page.locator('[data-slot="question-dock-body"]')
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect(body).not.toHaveAttribute("inert", "")

    await toggle.focus()
    await toggle.press("Enter")
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(body).toHaveAttribute("inert", "")

    await toggle.press("Enter")
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect(body).not.toHaveAttribute("inert", "")
  })
})

test.describe("PermissionDock accessibility interactions", () => {
  test("names permission actions and exposes remembered-rule toggle state", async ({ page }) => {
    await page.goto(story("composite-webview--bash-with-permission"), { waitUntil: "load" })

    await expect(page.getByRole("region", { name: "Permission required" })).toBeVisible()
    const header = page.getByRole("button", { name: "Manage Auto-Approve Rules" })
    const rules = page.locator('[data-slot="permission-rules-collapse"]')
    await expect(header).toHaveAttribute("aria-expanded", "false")
    await expect(rules).toHaveAttribute("aria-hidden", "true")

    await header.focus()
    await header.press("Enter")
    await expect(header).toHaveAttribute("aria-expanded", "true")
    await expect(rules).toHaveAttribute("aria-hidden", "false")

    const row = page.locator('[data-slot="permission-rule-row"]').first()
    const allow = page.getByRole("button", { name: "Allow always: bun", exact: true })
    const deny = page.getByRole("button", { name: "Deny: bun", exact: true })
    await expect(allow).toHaveAttribute("aria-pressed", "false")
    await allow.focus()
    await allow.press("Enter")
    await expect(allow).toHaveAttribute("aria-pressed", "true")
    await expect(row).toHaveAttribute("data-decision", "approved")

    await deny.focus()
    await deny.press("Space")
    await expect(allow).toHaveAttribute("aria-pressed", "false")
    await expect(deny).toHaveAttribute("aria-pressed", "true")
    await expect(row).toHaveAttribute("data-decision", "denied")

    const once = page.getByRole("button", { name: "Allow once" })
    await expect(once).toContainText("Run")
    await expect(page.getByRole("button", { name: "Deny", exact: true })).toBeVisible()
  })
})
