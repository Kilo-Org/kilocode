import { expect, test, type Page } from "@playwright/test"
import type { ChatSettingsLoadedMessage, ConfigLoadedMessage } from "../webview-ui/src/types/messages"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

async function open(page: Page, story: string) {
  await page.goto(`/iframe.html?id=${story}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
  await page.waitForSelector(".chat-view, [role=tablist]")
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({
    content: "*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }",
  })
}

async function visibility(page: Page, visible: boolean) {
  await page.evaluate((value) => {
    window.postMessage(
      {
        type: "chatSettingsLoaded",
        settings: {
          showSessionActions: value,
          shiftTabCyclesVariant: true,
          browserAutomation: false,
          agentManagerBrowserOpenLinksIn: "external",
          workspaceTrusted: true,
        },
      } satisfies ChatSettingsLoadedMessage,
      window.origin,
    )
  }, visible)
}

async function load(page: Page) {
  await page.waitForSelector("[role=tablist]")
  await page.evaluate(() =>
    window.postMessage(
      {
        type: "configLoaded",
        config: {},
        features: { indexing: false, sandboxControls: false, backgroundSubagents: false, speechToText: false },
      } satisfies ConfigLoadedMessage,
      window.origin,
    ),
  )
}

test("hides and restores New Worktree in the empty sidebar", async ({ page }) => {
  await open(page, "chat--welcome-with-switcher-and-notification")
  const button = page.getByRole("button", { name: "New Worktree", exact: true })
  await expect(button).toBeVisible()

  await visibility(page, false)
  await expect(button).toHaveCount(0)
  await expect(page.locator('[data-component="session-dock"]')).toHaveJSProperty("offsetHeight", 0)
  await expect(page.getByRole("textbox")).toBeVisible()

  await visibility(page, true)
  await expect(button).toBeVisible()
})

test("collapses idle session actions and preserves working and goal controls", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 640 })
  await open(page, "chat--chat-view-session-dock-stability")
  const buttons = ["New Session", "Fork Session", "Move to Worktree", "Show Changes"]
  for (const name of buttons) await expect(page.getByRole("button", { name, exact: true })).toBeVisible()
  const height = () => page.locator(".message-list").evaluate((node) => node.getBoundingClientRect().height)
  const before = await height()

  await visibility(page, false)
  for (const name of buttons) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0)
  await expect(page.locator('[data-component="session-dock"]')).toHaveJSProperty("offsetHeight", 0)
  expect(await height()).toBeGreaterThan(before)

  await page.getByTestId("toggle-busy").click()
  await expect(page.locator(".working-indicator")).toBeVisible()
  await page.getByTestId("toggle-busy").click()
  await expect(page.locator(".working-indicator")).toBeHidden()
  await page.getByTestId("toggle-goal").click()
  await expect(page.locator(".session-goal-action")).toBeVisible()
  await expect(page.locator(".session-goal-action")).toBeEnabled()
  for (const name of buttons) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0)

  await visibility(page, true)
  for (const name of buttons) await expect(page.getByRole("button", { name, exact: true })).toBeVisible()
})

test("stages, discards, and saves the Display preference", async ({ page }) => {
  await page.addInitScript(() => {
    const messages: unknown[] = []
    Object.defineProperty(window, "sent", { value: messages })
    Object.defineProperty(window, "acquireVsCodeApi", {
      value: () => ({
        postMessage: (message: unknown) => messages.push(message),
        getState: () => undefined,
        setState: () => {},
      }),
    })
  })
  await open(page, "settings--settings-panel")
  await load(page)
  await page.getByRole("tab", { name: "Display", exact: true }).click()
  const toggle = page.getByRole("switch", { name: "Show session actions", exact: true })
  const control = toggle.locator("..").locator('[data-slot="switch-control"]')
  await expect(toggle).toBeChecked()
  await control.click()
  await expect(toggle).not.toBeChecked()
  await page.getByRole("button", { name: "Discard", exact: true }).click()
  await expect(toggle).toBeChecked()

  await control.click()
  await page.getByRole("button", { name: "Save", exact: true }).click()
  const sent = await page.evaluate(() => (window as unknown as { sent: unknown[] }).sent)
  expect(sent).toContainEqual({ type: "updateSetting", key: "showSessionActions", value: false })
  await expect(page.locator(".settings-save-bar")).toHaveCount(0)

  await page.reload()
  await load(page)
  await page.getByRole("tab", { name: "Display", exact: true }).click()
  await visibility(page, false)
  await expect(toggle).not.toBeChecked()
  await expect(page.locator(".settings-save-bar")).toHaveCount(0)
})
