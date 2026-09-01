import { expect, test, type Locator, type Page } from "@playwright/test"
import type { WebviewMessage } from "../webview-ui/src/types/messages"

const globals = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const count = ".session-background-agents:visible"
const header = '[data-component="task-header-agents"]'
const parent = "background-parent"

async function open(page: Page, width = 420) {
  await page.setViewportSize({ width, height: 720 })
  await page.goto(`/iframe.html?id=chat--chat-view-background-agents&viewMode=story&globals=${globals}`)
  await page.addStyleTag({
    content: "*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }",
  })
  await expect(page.locator(count)).toHaveText("2 agents")
  await page.evaluate(() => document.fonts.ready)
}

async function events(page: Page, type: WebviewMessage["type"]) {
  const messages = JSON.parse((await page.getByTestId("background-events").textContent()) ?? "[]") as WebviewMessage[]
  return messages.filter((message) => message.type === type)
}

async function bounds(node: Locator) {
  const rect = await node.boundingBox()
  expect(rect).not.toBeNull()
  return rect!
}

for (const width of [200, 280, 420]) {
  test(`one count button shares the dock row and focuses the top bar at ${width}px`, async ({ page }) => {
    await open(page, width)
    const dock = page.locator('[data-component="session-dock"]')
    const height = (await bounds(dock)).height
    for (const selector of [".session-actions-row", ".working-indicator"]) {
      await expect(page.locator(count)).toHaveCount(1)
      await expect(page.locator(`${selector} ${count}`)).toHaveCount(1)
      await expect(dock.locator('.session-dock-state[aria-hidden="true"] .session-background-agents')).toHaveCount(1)
      await expect(page.locator(".prompt-input-container .session-background-agents")).toHaveCount(0)
      const rect = await bounds(page.locator(count))
      const peers = await page
        .locator(`${selector}:visible`)
        .locator("button:not(.session-background-agents), .working-status, .working-elapsed")
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const box = node.getBoundingClientRect()
            return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }
          }),
        )
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(width)
      expect(rect.y + rect.height).toBeLessThanOrEqual((await bounds(page.locator(".prompt-input-container"))).y)
      const shared = peers.some((peer) => peer.top < rect.y + rect.height && peer.bottom > rect.y)
      expect.soft(shared, `${selector} shares the count row`).toBe(true)
      for (const peer of peers) {
        const x = Math.min(rect.x + rect.width, peer.right) - Math.max(rect.x, peer.left)
        const y = Math.min(rect.y + rect.height, peer.bottom) - Math.max(rect.y, peer.top)
        expect(x > 0.5 && y > 0.5, `count overlaps ${selector} control at ${width}px`).toBe(false)
      }
      await page.locator(count).click()
      await expect(page.locator(`${header} [data-slot="task-header-todos-list"]`)).toBeVisible()
      await expect(page.locator(`${header} [data-slot="task-header-agents-toggle"]`)).toBeFocused()
      await page.locator(`${header} [data-slot="task-header-agents-toggle"]`).click()
      await page.getByTestId("toggle-busy").click()
      await expect.poll(async () => (await bounds(dock)).height).toBe(height)
    }
  })
}

test("standalone prompt and task header stories keep their own context", async ({ page }) => {
  for (const story of [
    { id: "prompt-input--with-thinking-200", selector: ".prompt-input" },
    { id: "chat--task-header-with-todos", selector: '[data-component="task-header-todos"]' },
    { id: "chat--task-header-with-todos-all-done", selector: '[data-component="task-header-todos"]' },
    { id: "chat--task-header-background-agents-420", selector: header },
  ]) {
    await page.goto(`/iframe.html?id=${story.id}&viewMode=story&globals=${globals}`)
    await expect(page.locator(story.selector)).toBeVisible()
    await expect(page.locator(count)).toHaveCount(0)
  }
  await page.locator('[data-slot="task-header-agents-toggle"]').click()
  await expect(page.locator('[data-slot="task-header-agent"]')).toHaveCount(3)
})

test("top bar opens, stops, and dismisses individual agents", async ({ page }) => {
  await open(page)
  await page.locator(count).click()
  const list = page.locator(`${header} [data-slot="task-header-todos-list"]`)
  const rows = list.locator('[data-slot="task-header-agent"]')
  await expect(rows).toHaveCount(3)
  await expect(list.getByText("Other session task", { exact: true })).toHaveCount(0)
  await list.getByRole("button", { name: "Open background agent: Trace request limits", exact: true }).click()
  await expect
    .poll(() => events(page, "openSubAgentViewer"))
    .toEqual([
      {
        type: "openSubAgentViewer",
        sessionID: "background-limits",
        title: "Trace request limits",
        parentSessionID: parent,
      },
    ])
  await list.getByRole("button", { name: "Stop: Trace request limits", exact: true }).click()
  await expect
    .poll(() => events(page, "cancelBackgroundJob"))
    .toEqual([{ type: "cancelBackgroundJob", sessionID: parent, jobID: "job-limits", requestID: expect.any(String) }])
  await expect(rows.filter({ hasText: "Trace request limits" })).toHaveAttribute("data-status", "cancelled")
  await expect(rows.filter({ hasText: "Check prompt layout" })).toHaveAttribute("data-status", "running")
  await expect(page.locator(count)).toHaveText("1 agent")
  await expect(page.locator(`${header} [data-slot="task-header-agents-actions"]`)).toHaveText("Stop all (1)")
  await list.getByRole("button", { name: "Dismiss: Trace request limits", exact: true }).click()
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: "Trace request limits" })).toHaveCount(0)
  expect(await events(page, "abort")).toEqual([])
})

for (const action of ["Escape", "Stop"]) {
  test(`main ${action} stops only the parent with the top bar open`, async ({ page }) => {
    await open(page)
    await page.getByTestId("toggle-busy").click()
    await page.locator(count).click()
    await (action === "Escape"
      ? page.keyboard.press(action)
      : page.locator(".prompt-input-hint-actions").getByRole("button", { name: "Stop", exact: true }).click())
    await expect.poll(() => events(page, "abort")).toEqual([{ type: "abort", sessionID: parent, scope: "session" }])
    await expect(page.getByTestId("background-fixture")).toHaveAttribute("data-status", "idle")
    await expect(page.locator(count)).toHaveText("2 agents")
    expect(await events(page, "cancelBackgroundJob")).toEqual([])
  })
}

test("Stop all immediately stops this session's running tasks without a dialog or parent abort", async ({ page }) => {
  await open(page)
  await page.getByTestId("toggle-busy").click()
  await page.locator(count).click()
  await page
    .locator(`${header} [data-slot="task-header-agents-actions"]`)
    .getByRole("button", { name: "Stop all (2)", exact: true })
    .click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect
    .poll(() => events(page, "cancelBackgroundJob"))
    .toEqual([
      { type: "cancelBackgroundJob", sessionID: parent, jobID: "job-limits", requestID: expect.any(String) },
      { type: "cancelBackgroundJob", sessionID: parent, jobID: "job-layout", requestID: expect.any(String) },
    ])
  await expect(page.locator(count)).toHaveCount(0)
  await expect(page.getByTestId("background-fixture")).toHaveAttribute("data-status", "busy")
  expect(await events(page, "abort")).toEqual([])
})
