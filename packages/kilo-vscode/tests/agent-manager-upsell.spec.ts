import { expect, test, type Page } from "@playwright/test"
import type { WebviewMessage } from "../webview-ui/src/types/messages"

async function scene(page: Page, detail: Record<string, boolean>) {
  await page.evaluate((detail) => window.dispatchEvent(new CustomEvent("upsellStoryChange", { detail })), detail)
}

const card = (page: Page) => page.locator(".agent-manager-upsell")
const actions = (page: Page) =>
  page.evaluate(() =>
    (window as Window & { upsell: WebviewMessage[] }).upsell
      .filter((message) => message.type === "telemetry" && message.event === "Agent Manager Upsell")
      .map((message) => (message.type === "telemetry" ? message.properties?.["action"] : undefined)),
  )

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const messages: WebviewMessage[] = []
    Object.assign(window, {
      upsell: messages,
      acquireVsCodeApi: () => ({
        postMessage: (message: WebviewMessage) => messages.push(message),
        getState: () => undefined,
        setState: () => {},
      }),
    })
  })
})

test("hidden sidebar waits for visibility and idle without stealing focus", async ({ page }) => {
  await page.goto("/iframe.html?id=chat--chat-agent-manager-upsell-hidden&viewMode=story")
  const input = page.getByRole("textbox", { name: "Focus sentinel" })
  await input.focus()
  await expect(card(page)).toHaveCount(0)
  expect(await actions(page)).toEqual([])
  await scene(page, { active: true, idle: false })
  await expect(card(page)).toHaveCount(0)
  await scene(page, { idle: true })
  await expect(card(page)).toBeVisible()
  await expect(input).toBeFocused()
  await expect(card(page)).toHaveAttribute("role", "status")
  await expect(card(page)).toHaveAttribute("aria-live", "polite")
  expect(await actions(page)).toEqual(["shown"])
  await scene(page, { active: false })
  await expect(card(page)).toHaveCount(0)
  await scene(page, { active: true })
  await expect(card(page)).toBeVisible()
  expect(await actions(page)).toEqual(["shown"])
})

for (const story of ["disabled", "editor"]) {
  test(`${story} surface never requests or records an impression`, async ({ page }) => {
    await page.goto(`/iframe.html?id=chat--chat-agent-manager-upsell-${story}&viewMode=story`)
    await expect(page.getByRole("textbox", { name: "Focus sentinel" })).toBeVisible()
    await expect(card(page)).toHaveCount(0)
    expect(await actions(page)).toEqual([])
    expect(
      await page.evaluate(() =>
        (window as Window & { upsell: WebviewMessage[] }).upsell.filter(
          (message) => message.type === "agentManagerUpsell",
        ),
      ),
    ).toEqual([])
  })
}

test("Escape outside is untouched; inside snoozes using a keyboard button", async ({ page }) => {
  await page.goto("/iframe.html?id=chat--chat-agent-manager-upsell&viewMode=story")
  await expect(card(page)).toBeVisible()
  await page.getByRole("textbox", { name: "Focus sentinel" }).press("Escape")
  await expect(card(page)).toBeVisible()
  await card(page).getByRole("button", { name: "Not now", exact: true }).focus()
  await page.keyboard.press("Escape")
  await expect(card(page)).toHaveCount(0)
  expect(await actions(page)).toEqual(["shown", "not_now"])
  await scene(page, { eligible: false })
  await scene(page, { eligible: true })
  await expect(card(page)).toHaveCount(0)
})

test("opt-out confirmation expires after six seconds and Undo cancels the old timer", async ({ page }) => {
  await page.goto("/iframe.html?id=chat--chat-agent-manager-upsell&viewMode=story")
  await expect(card(page)).toBeVisible()
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") })
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"))
  await card(page).getByRole("button", { name: "Don't show this again", exact: true }).click()
  await expect(card(page)).toContainText("Got it. We won't suggest Agent Manager here again.")
  await page.clock.fastForward(5900)
  await expect(card(page)).toBeVisible()
  await card(page).getByRole("button", { name: "Undo", exact: true }).press("Enter")
  await expect(card(page)).toContainText("Put a fleet of Kilo agents to work")
  await page.clock.fastForward(1000)
  await expect(card(page)).toBeVisible()
  expect(await actions(page)).toEqual(["shown", "dont_show_again", "undo"])
  await card(page).getByRole("button", { name: "Don't show this again", exact: true }).click()
  await page.clock.fastForward(6000)
  await expect(card(page)).toHaveCount(0)
})

test("Open Agent Manager uses the same message as the existing people icon", async ({ page }) => {
  await page.goto("/iframe.html?id=chat--chat-agent-manager-upsell&viewMode=story")
  await expect(card(page)).toBeVisible()
  await card(page).getByRole("button", { name: "Open Agent Manager", exact: true }).click()
  await expect(card(page)).toHaveCount(0)
  expect(await actions(page)).toEqual(["shown", "opened"])
  await page.getByRole("toolbar").getByRole("button", { name: "Agent Manager", exact: true }).click()
  expect(
    await page.evaluate(() =>
      (window as Window & { upsell: WebviewMessage[] }).upsell.filter((message) => message.type === "openAgentManager"),
    ),
  ).toEqual([{ type: "openAgentManager" }, { type: "openAgentManager" }])
})

test("stale persistence replies cannot resurrect a dismissed toast", async ({ page }) => {
  await page.goto("/iframe.html?id=chat--chat-agent-manager-upsell&viewMode=story")
  await expect(card(page)).toBeVisible()
  await card(page).getByRole("button", { name: "Not now", exact: true }).click()
  await page.evaluate(() => {
    const request = (window as Window & { upsell: WebviewMessage[] }).upsell.find(
      (message) => message.type === "agentManagerUpsell" && message.action === "shown",
    )
    if (request?.type !== "agentManagerUpsell") throw new Error("Missing initial claim")
    window.postMessage(
      { type: "agentManagerUpsellLoaded", request: request.request, state: {}, engaged: true, display: true },
      window.location.origin,
    )
  })
  await expect(card(page)).toHaveCount(0)
})

test("normal motion uses the specified 450ms entrance", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/iframe.html?id=chat--chat-agent-manager-upsell&viewMode=story")
  await expect(card(page)).toBeVisible()
  await expect(card(page)).toHaveCSS("animation-duration", "0.45s")
})

for (const theme of ["light-modern", "hc-black", "hc-light"]) {
  test(`keeps readable theme surfaces in ${theme}`, async ({ page }, info) => {
    await page.goto(
      `/iframe.html?id=chat--chat-agent-manager-upsell&viewMode=story&globals=theme:kilo-vscode;vscodeTheme:${theme}`,
    )
    await expect(card(page)).toBeVisible()
    const colors = await card(page).evaluate((node) => ({
      text: getComputedStyle(node.querySelector(".agent-manager-upsell-title")!).color,
      background: getComputedStyle(node.querySelector(".agent-manager-upsell-body")!).backgroundImage,
    }))
    expect(colors.background).toContain("gradient")
    expect(colors.text).not.toBe("rgba(0, 0, 0, 0)")
    await page.screenshot({ path: info.outputPath(`final-${theme}.png`) })
  })
}

for (const width of [200, 297, 430]) {
  test(`final toast wraps without clipping at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 800 })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/iframe.html?id=chat--chat-agent-manager-upsell&viewMode=story")
    await expect(card(page)).toBeVisible()
    await expect(card(page)).toHaveCSS("animation-name", "none")
    const bounds = await card(page).evaluate((node) => ({
      width: node.clientWidth,
      scroll: node.scrollWidth,
      animation: getComputedStyle(node).animationName,
    }))
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width)
    expect(bounds.animation).toBe("none")
    for (const button of await card(page).getByRole("button").all()) {
      const box = await button.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(12)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width - 12)
    }
    await page.screenshot({ path: info.outputPath(`final-shown-${width}.png`) })
    await card(page).getByRole("button", { name: "Don't show this again", exact: true }).click()
    await page.screenshot({ path: info.outputPath(`final-confirmation-${width}.png`) })
    await card(page).getByRole("button", { name: "Undo", exact: true }).click()
    await card(page).getByRole("button", { name: "Not now", exact: true }).click()
    await page.screenshot({ path: info.outputPath(`final-dismissed-${width}.png`) })
  })
}
