import { expect, test, type Page } from "@playwright/test"
import type { WebviewMessage } from "../webview-ui/src/types/messages"

async function scene(page: Page, detail: Record<string, boolean>) {
  await page.evaluate((detail) => window.dispatchEvent(new CustomEvent("upsellStoryChange", { detail })), detail)
}

const card = (page: Page) => page.locator(".agent-manager-upsell")
async function arrow(page: Page) {
  const button = card(page).locator(".agent-manager-upsell-primary")
  const color = await button.evaluate((node) => getComputedStyle(node).color)
  expect(color).toBe("rgb(22, 23, 26)")
  await expect(button.locator('[data-component="icon"]')).toHaveCSS("color", color)
  await expect(button.locator('[data-slot="icon-svg"]')).toHaveCSS("color", color)
}
const actions = (page: Page) =>
  page.evaluate(() =>
    (window as Window & { upsell: WebviewMessage[] }).upsell
      .filter((message) => message.type === "telemetry" && message.event === "Agent Manager Upsell")
      .map((message) => (message.type === "telemetry" ? message.properties?.["action"] : undefined)),
  )

async function impression(page: Page) {
  await page.evaluate(async () => {
    const seen = () =>
      (window as Window & { upsell: WebviewMessage[] }).upsell.some(
        (message) =>
          message.type === "telemetry" &&
          message.event === "Agent Manager Upsell" &&
          message.properties?.["action"] === "shown",
      )
    if (seen()) return
    const done = Promise.withResolvers<void>()
    const receive = () => {
      if (!seen()) return
      window.removeEventListener("upsellMessage", receive)
      done.resolve()
    }
    window.addEventListener("upsellMessage", receive)
    await done.promise
  })
}

async function hold(page: Page) {
  await page.addInitScript(() => {
    const post = window.postMessage.bind(window)
    const replies: unknown[] = []
    Object.assign(window, {
      held: replies,
      deliver: () => post(replies.shift(), window.location.origin),
    })
    window.postMessage = (message: unknown, options?: string | WindowPostMessageOptions, transfer?: Transferable[]) => {
      if (message && typeof message === "object" && "type" in message && message.type === "agentManagerUpsellLoaded") {
        replies.push(message)
        window.dispatchEvent(new Event("upsellReplyHeld"))
        return
      }
      if (typeof options === "string") return post(message, options, transfer)
      post(message, options)
    }
  })
}

async function deliver(page: Page) {
  await page.evaluate(async () => {
    const boundary = window as Window & { held: unknown[]; deliver(): void }
    if (!boundary.held.length) {
      const ready = Promise.withResolvers<void>()
      window.addEventListener("upsellReplyHeld", () => ready.resolve(), { once: true })
      await ready.promise
    }
    boundary.deliver()
  })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const messages: WebviewMessage[] = []
    Object.assign(window, {
      upsell: messages,
      acquireVsCodeApi: () => ({
        postMessage: (message: WebviewMessage) => {
          messages.push(message)
          window.dispatchEvent(new Event("upsellMessage"))
        },
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
  await impression(page)
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
  await scene(page, { enabled: false })
  await expect(card(page)).toHaveCount(0)
  await scene(page, { enabled: true })
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

test("an accepted reply arriving hidden is retained until the sidebar is visible", async ({ page }) => {
  await hold(page)
  await page.goto("/iframe.html?id=chat--chat-agent-manager-upsell&viewMode=story")
  await expect(page.getByRole("textbox", { name: "Focus sentinel" })).toBeVisible()
  await scene(page, { active: false })
  await deliver(page)
  await expect(card(page)).toHaveCount(0)
  expect(await actions(page)).toEqual([])
  await scene(page, { active: true })
  await deliver(page)
  await expect(card(page)).toBeVisible()
  await impression(page)
  expect(await actions(page)).toEqual(["shown"])
  const claims = await page.evaluate(() =>
    (window as Window & { upsell: WebviewMessage[] }).upsell.filter(
      (message) => message.type === "agentManagerUpsell" && message.action === "shown",
    ),
  )
  expect(claims).toHaveLength(2)
})

test("an in-flight grant waits through a new turn and its delayed changed-file summary", async ({ page }) => {
  await hold(page)
  await page.goto("/iframe.html?id=chat--chat-agent-manager-upsell-full-sidebar&viewMode=story")
  await expect(page.locator(".chat-view")).toBeVisible()
  await scene(page, { idle: true })
  await scene(page, { idle: false, eligible: false })
  await deliver(page)
  await expect(card(page)).toHaveCount(0)
  await scene(page, { idle: true })
  await expect(card(page)).toHaveCount(0)
  expect(await actions(page)).toEqual([])
  await scene(page, { eligible: true })
  await deliver(page)
  await expect(card(page)).toBeVisible()
  await impression(page)
  expect(await actions(page)).toEqual(["shown"])
})

test("the actual short sidebar reserves its same composer and toolbar while the toast scrolls", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 297, height: 400 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/iframe.html?id=chat--chat-agent-manager-upsell-full-sidebar&viewMode=story")
  const input = page.locator(".prompt-input-container")
  await expect(input).toBeVisible()
  await input.evaluate((node) => node.setAttribute("data-upsell-composer", "retained"))
  await scene(page, { idle: true })
  await expect(card(page)).toBeVisible()
  for (const selector of [".prompt-input-container", ".session-dock"]) {
    const bounds = await page.locator(selector).boundingBox()
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(400)
  }
  const slot = page.locator(".agent-manager-upsell-slot")
  expect(await slot.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
  await expect(card(page)).toHaveCSS("opacity", "1")
  await page.screenshot({ path: info.outputPath("final-r1-short-sidebar-fixed.png") })
  await page.setViewportSize({ width: 297, height: 800 })
  await expect(card(page)).toBeVisible()
  await expect(input).toHaveAttribute("data-upsell-composer", "retained")
  expect(await slot.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true)
  await page.setViewportSize({ width: 297, height: 400 })
  await card(page).getByRole("button", { name: "Not now", exact: true }).click()
  await expect(card(page)).toHaveCount(0)
  const bounds = await input.boundingBox()
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(400)
})

test("zero promo space keeps the grant unconsumed and exposes it on resize without replacing the composer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 297, height: 400 })
  await page.goto("/iframe.html?id=chat--chat-agent-manager-upsell-full-sidebar&viewMode=story")
  await expect(page.locator(".chat-view")).toBeVisible()
  await scene(page, { idle: true, eligible: false })
  await expect(page.locator(".new-task-button-wrapper")).toBeVisible()
  const spare = await page.locator(".chat-messages-wrapper").evaluate((node) => node.getBoundingClientRect().height)
  const height = Math.floor(400 - spare)
  await page.setViewportSize({ width: 297, height })
  await scene(page, { eligible: true })
  await expect(card(page)).toHaveCount(1)
  expect(await page.locator(".agent-manager-upsell-slot").evaluate((node) => node.clientHeight)).toBe(0)
  await expect(card(page)).toHaveAttribute("inert", "")
  await expect(card(page)).toHaveAttribute("aria-hidden", "true")
  expect(await actions(page)).toEqual([])
  expect(
    await page.evaluate(() =>
      (window as Window & { upsell: WebviewMessage[] }).upsell.filter(
        (message) => message.type === "agentManagerUpsell" && message.action === "rendered",
      ),
    ),
  ).toEqual([])
  const bounds = await page.locator(".prompt-input-container").boundingBox()
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height + 1)
  await page.setViewportSize({ width: 297, height: 400 })
  await expect(card(page)).toHaveAttribute("aria-hidden", "false")
  await impression(page)
  expect(await actions(page)).toEqual(["shown"])
  await page.setViewportSize({ width: 297, height: 800 })
  expect(await actions(page)).toEqual(["shown"])
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
    await arrow(page)
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
    await arrow(page)
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
