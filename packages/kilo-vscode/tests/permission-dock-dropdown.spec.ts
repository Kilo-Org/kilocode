/**
 * Screenshot tests for the PermissionDock dropdown (expanded "Permission rules" section).
 *
 * These tests navigate to existing Storybook stories, interact with the dropdown
 * (click to expand, toggle approve/deny on individual rules), and capture screenshots
 * of each state.
 *
 * The existing visual-regression.spec.ts covers the collapsed (default) state.
 * This file covers interactive states that require clicking.
 */

import { test, expect, type Page } from "@playwright/test"
import { platform } from "node:os"

const IS_DARWIN = platform() === "darwin"

// Screenshot baselines are captured on Linux CI — skip on macOS.
if (IS_DARWIN) {
  console.warn("Visual regression tests must be run on CI, skipping on local macOS.")
  test.skip()
}

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

function storyUrl(storyId: string) {
  return `/iframe.html?id=${storyId}&viewMode=story&globals=${GLOBALS}`
}

async function disableAnimations(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  })
}

async function openDropdown(page: Page) {
  const header = page.locator('[data-slot="permission-rules-header"]')
  await header.waitFor({ state: "visible" })
  await header.click()
  await page.locator('[data-slot="permission-rules-collapse"][data-open]').waitFor({ state: "visible" })
}

// Match the viewport used by visual-regression.spec.ts for composite stories.
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 720 })
})

// ---------------------------------------------------------------------------
// Bash permission — dropdown expanded (all rules pending)
// ---------------------------------------------------------------------------

test.describe("Permission Dock Dropdown — bash", () => {
  const STORY_ID = "composite-webview--bash-with-permission"

  test("rules expanded — all pending", async ({ page }) => {
    await page.goto(storyUrl(STORY_ID), { waitUntil: "load" })
    await disableAnimations(page)
    await page.waitForSelector("#storybook-root *", { state: "attached" })
    await openDropdown(page)

    const root = page.locator("#storybook-root")
    await expect(root).toHaveScreenshot(["permission-dock-dropdown", "bash-expanded-pending.png"])
  })

  test("rules expanded — first rule approved", async ({ page }) => {
    await page.goto(storyUrl(STORY_ID), { waitUntil: "load" })
    await disableAnimations(page)
    await page.waitForSelector("#storybook-root *", { state: "attached" })
    await openDropdown(page)

    // Click the first approve toggle (dispatchEvent bypasses tooltip overlays)
    const approveButtons = page.locator('[data-slot="permission-rule-toggle"][data-variant="approve"]')
    await approveButtons.first().dispatchEvent("click")

    const root = page.locator("#storybook-root")
    await expect(root).toHaveScreenshot(["permission-dock-dropdown", "bash-rule-approved.png"])
  })

  test("rules expanded — first rule denied", async ({ page }) => {
    await page.goto(storyUrl(STORY_ID), { waitUntil: "load" })
    await disableAnimations(page)
    await page.waitForSelector("#storybook-root *", { state: "attached" })
    await openDropdown(page)

    // Click the first deny toggle (dispatchEvent bypasses tooltip overlays)
    const denyButtons = page.locator('[data-slot="permission-rule-toggle"][data-variant="deny"]')
    await denyButtons.first().dispatchEvent("click")

    const root = page.locator("#storybook-root")
    await expect(root).toHaveScreenshot(["permission-dock-dropdown", "bash-rule-denied.png"])
  })

  test("rules expanded — mixed (first approved, second denied)", async ({ page }) => {
    await page.goto(storyUrl(STORY_ID), { waitUntil: "load" })
    await disableAnimations(page)
    await page.waitForSelector("#storybook-root *", { state: "attached" })
    await openDropdown(page)

    // Approve first rule, deny second rule (dispatchEvent bypasses tooltip overlays)
    const approveButtons = page.locator('[data-slot="permission-rule-toggle"][data-variant="approve"]')
    const denyButtons = page.locator('[data-slot="permission-rule-toggle"][data-variant="deny"]')
    await approveButtons.first().dispatchEvent("click")
    await denyButtons.nth(1).dispatchEvent("click")

    const root = page.locator("#storybook-root")
    await expect(root).toHaveScreenshot(["permission-dock-dropdown", "bash-rules-mixed.png"])
  })
})

// ---------------------------------------------------------------------------
// Glob permission — dropdown expanded
// ---------------------------------------------------------------------------

test.describe("Permission Dock Dropdown — glob", () => {
  const STORY_ID = "composite-webview--glob-with-permission"

  test("rules expanded — all pending", async ({ page }) => {
    await page.goto(storyUrl(STORY_ID), { waitUntil: "load" })
    await disableAnimations(page)
    await page.waitForSelector("#storybook-root *", { state: "attached" })
    await openDropdown(page)

    const root = page.locator("#storybook-root")
    await expect(root).toHaveScreenshot(["permission-dock-dropdown", "glob-expanded-pending.png"])
  })

  test("rules expanded — rule approved", async ({ page }) => {
    await page.goto(storyUrl(STORY_ID), { waitUntil: "load" })
    await disableAnimations(page)
    await page.waitForSelector("#storybook-root *", { state: "attached" })
    await openDropdown(page)

    const approveButtons = page.locator('[data-slot="permission-rule-toggle"][data-variant="approve"]')
    await approveButtons.first().dispatchEvent("click")

    const root = page.locator("#storybook-root")
    await expect(root).toHaveScreenshot(["permission-dock-dropdown", "glob-rule-approved.png"])
  })
})

// ---------------------------------------------------------------------------
// Write permission — dropdown expanded
// ---------------------------------------------------------------------------

test.describe("Permission Dock Dropdown — write", () => {
  const STORY_ID = "composite-webview--permission-dock-write"

  test("rules expanded — all pending", async ({ page }) => {
    await page.goto(storyUrl(STORY_ID), { waitUntil: "load" })
    await disableAnimations(page)
    await page.waitForSelector("#storybook-root *", { state: "attached" })
    await openDropdown(page)

    const root = page.locator("#storybook-root")
    await expect(root).toHaveScreenshot(["permission-dock-dropdown", "write-expanded-pending.png"])
  })
})

// ---------------------------------------------------------------------------
// Edit permission — dropdown expanded
// ---------------------------------------------------------------------------

test.describe("Permission Dock Dropdown — edit", () => {
  const STORY_ID = "composite-webview--permission-dock-edit"

  test("rules expanded — all pending", async ({ page }) => {
    await page.goto(storyUrl(STORY_ID), { waitUntil: "load" })
    await disableAnimations(page)
    await page.waitForSelector("#storybook-root *", { state: "attached" })
    await openDropdown(page)

    const root = page.locator("#storybook-root")
    await expect(root).toHaveScreenshot(["permission-dock-dropdown", "edit-expanded-pending.png"])
  })
})

// ---------------------------------------------------------------------------
// Websearch permission — dropdown expanded
// ---------------------------------------------------------------------------

test.describe("Permission Dock Dropdown — websearch", () => {
  const STORY_ID = "composite-webview--permission-dock-websearch"

  test("rules expanded — all pending", async ({ page }) => {
    await page.goto(storyUrl(STORY_ID), { waitUntil: "load" })
    await disableAnimations(page)
    await page.waitForSelector("#storybook-root *", { state: "attached" })
    await openDropdown(page)

    const root = page.locator("#storybook-root")
    await expect(root).toHaveScreenshot(["permission-dock-dropdown", "websearch-expanded-pending.png"])
  })
})

// ---------------------------------------------------------------------------
// External directory permission — dropdown expanded
// ---------------------------------------------------------------------------

test.describe("Permission Dock Dropdown — external directory", () => {
  const STORY_ID = "composite-webview--permission-dock-external-dir"

  test("rules expanded — all pending", async ({ page }) => {
    await page.goto(storyUrl(STORY_ID), { waitUntil: "load" })
    await disableAnimations(page)
    await page.waitForSelector("#storybook-root *", { state: "attached" })
    await openDropdown(page)

    const root = page.locator("#storybook-root")
    await expect(root).toHaveScreenshot(["permission-dock-dropdown", "external-dir-expanded-pending.png"])
  })
})

// ---------------------------------------------------------------------------
// Bash with many rules (6 rules) — dropdown expanded
// ---------------------------------------------------------------------------

test.describe("Permission Dock Dropdown — many rules", () => {
  const STORY_ID = "composite-webview--permission-dock-bash-many-rules"

  test("rules expanded — all pending (overflow)", async ({ page }) => {
    await page.goto(storyUrl(STORY_ID), { waitUntil: "load" })
    await disableAnimations(page)
    await page.waitForSelector("#storybook-root *", { state: "attached" })
    await openDropdown(page)

    const root = page.locator("#storybook-root")
    await expect(root).toHaveScreenshot(["permission-dock-dropdown", "many-rules-expanded-pending.png"])
  })

  test("rules expanded — some approved, some denied", async ({ page }) => {
    await page.goto(storyUrl(STORY_ID), { waitUntil: "load" })
    await disableAnimations(page)
    await page.waitForSelector("#storybook-root *", { state: "attached" })
    await openDropdown(page)

    // Approve first 3 rules, deny the 4th.
    // Use dispatchEvent to bypass any overlay/tooltip interception issues.
    const rows = page.locator('[data-slot="permission-rule-row"]')
    const approveInRow = (n: number) =>
      rows.nth(n).locator('[data-slot="permission-rule-toggle"][data-variant="approve"]')
    const denyInRow = (n: number) => rows.nth(n).locator('[data-slot="permission-rule-toggle"][data-variant="deny"]')

    await approveInRow(0).dispatchEvent("click")
    await expect(rows.nth(0)).toHaveAttribute("data-decision", "approved")
    await approveInRow(1).dispatchEvent("click")
    await expect(rows.nth(1)).toHaveAttribute("data-decision", "approved")
    await approveInRow(2).dispatchEvent("click")
    await expect(rows.nth(2)).toHaveAttribute("data-decision", "approved")
    await denyInRow(3).dispatchEvent("click")

    const root = page.locator("#storybook-root")
    await expect(root).toHaveScreenshot(["permission-dock-dropdown", "many-rules-mixed.png"])
  })
})

// ---------------------------------------------------------------------------
// Subagent permission — shows "(subagent)" in subtitle
// ---------------------------------------------------------------------------

test.describe("Permission Dock Dropdown — subagent", () => {
  const STORY_ID = "composite-webview--permission-dock-subagent"

  test("subagent label visible, rules expanded", async ({ page }) => {
    await page.goto(storyUrl(STORY_ID), { waitUntil: "load" })
    await disableAnimations(page)
    await page.waitForSelector("#storybook-root *", { state: "attached" })
    await openDropdown(page)

    const root = page.locator("#storybook-root")
    await expect(root).toHaveScreenshot(["permission-dock-dropdown", "subagent-expanded.png"])
  })
})
