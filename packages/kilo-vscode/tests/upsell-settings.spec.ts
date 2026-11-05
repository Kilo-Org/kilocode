import { expect, test, type Page } from "@playwright/test"
import type { WebviewMessage } from "../webview-ui/src/types/messages"

const card = (page: Page) => page.locator(".agent-manager-upsell")
const toggle = (page: Page) => page.getByRole("switch", { name: "Agent Manager Sidebar Invitation" })
async function enable(page: Page, value: boolean) {
  if ((await toggle(page).isChecked()) === value) return
  await toggle(page).focus()
  await toggle(page).press("Space")
  await expect(toggle(page)).toBeChecked({ checked: value })
}
const requests = (page: Page) =>
  page.evaluate(() =>
    (window as Window & { sent: WebviewMessage[] }).sent.filter((message) => message.type === "agentManagerUpsell"),
  )

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const sent: WebviewMessage[] = []
    Object.assign(window, {
      sent,
      acquireVsCodeApi: () => ({
        postMessage: (message: WebviewMessage) => sent.push(message),
        getState: () => undefined,
        setState: () => {},
      }),
    })
  })
})

test("default OFF, live opt-in and OFF use the real settings row and ChatView gate", async ({ page }) => {
  await page.goto("/iframe.html?id=upsell-settings--sidebar&viewMode=story")
  await expect(toggle(page)).toBeAttached({ timeout: 20_000 })
  await expect(toggle(page)).not.toBeChecked()
  await page.getByRole("button", { name: "Toggle turn", exact: true }).click()
  await expect(card(page)).toHaveCount(0)
  expect(await requests(page)).toEqual([])
  await enable(page, true)
  await expect(card(page)).toBeVisible()
  expect(await page.evaluate(() => (window as Window & { sent: WebviewMessage[] }).sent)).toContainEqual({
    type: "updateSetting",
    key: "experimental.agentManagerUpsell",
    value: true,
  })
  await expect
    .poll(async () => (await requests(page)).filter((message) => message.action === "rendered").length)
    .toBe(1)
  await enable(page, false)
  await expect(card(page)).toHaveCount(0)
  await enable(page, true)
  await expect(card(page)).toHaveCount(0)
  expect((await requests(page)).filter((message) => message.action === "rendered")).toHaveLength(1)
})

test("live enable fails closed while the authoritative policy reply is pending", async ({ page }) => {
  await page.addInitScript(() => {
    const post = window.postMessage.bind(window)
    const replies: unknown[] = []
    Object.assign(window, { release: () => replies.splice(0).forEach((message) => post(message, location.origin)) })
    window.postMessage = (message: unknown, options?: string | WindowPostMessageOptions, transfer?: Transferable[]) => {
      if (message && typeof message === "object" && "type" in message && message.type === "agentManagerUpsellLoaded") {
        replies.push(message)
        return
      }
      if (typeof options === "string") return post(message, options, transfer)
      post(message, options)
    }
  })
  await page.goto("/iframe.html?id=upsell-settings--sidebar&viewMode=story")
  await page.getByRole("button", { name: "Toggle turn", exact: true }).click()
  await enable(page, true)
  await expect.poll(async () => (await requests(page)).length).toBe(1)
  await expect(card(page)).toHaveCount(0)
  await page.evaluate(() => (window as Window & { release(): void }).release())
  await expect(card(page)).toBeVisible()
})

for (const action of ["Not now", "Don't show this again", "Open Agent Manager"]) {
  test(`${action} policy survives OFF/ON and reload without resetting the preference`, async ({ page }) => {
    await page.goto("/iframe.html?id=upsell-settings--sidebar&viewMode=story")
    await enable(page, true)
    await page.getByRole("button", { name: "Toggle turn", exact: true }).click()
    await expect(card(page)).toBeVisible()
    await card(page).getByRole("button", { name: action, exact: true }).click()
    await expect.poll(() => page.evaluate(() => localStorage.getItem("upsell.policy"))).not.toBeNull()
    const policy = await page.evaluate(() => localStorage.getItem("upsell.policy"))
    await enable(page, false)
    await expect(card(page)).toHaveCount(0)
    await enable(page, true)
    await page.reload()
    await expect(toggle(page)).toBeChecked()
    await page.getByRole("button", { name: "Toggle turn", exact: true }).click()
    await expect.poll(async () => (await requests(page)).length).toBeGreaterThan(0)
    await expect(card(page)).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem("upsell.policy"))).toBe(policy)
  })
}

test("OFF/ON and webview remount cannot create a second automatic impression in the same host", async ({ page }) => {
  await page.goto("/iframe.html?id=upsell-settings--sidebar&viewMode=story")
  await enable(page, true)
  await page.getByRole("button", { name: "Toggle turn", exact: true }).click()
  await expect(card(page)).toHaveAttribute("aria-hidden", "false")
  await expect
    .poll(async () => (await requests(page)).filter((message) => message.action === "rendered").length)
    .toBe(1)
  await enable(page, false)
  await page.getByRole("button", { name: "Toggle chat mount", exact: true }).click()
  await enable(page, true)
  await page.getByRole("button", { name: "Toggle chat mount", exact: true }).click()
  await page.getByRole("button", { name: "Toggle turn", exact: true }).click()
  await page.getByRole("button", { name: "Toggle turn", exact: true }).click()
  await expect.poll(async () => (await requests(page)).filter((message) => message.action === "shown").length).toBe(2)
  await expect(card(page)).toHaveCount(0)
})

for (const state of [{ optedOut: true }, { snoozedAt: Date.now(), snoozeCount: 1 }]) {
  test(`re-enable honors ${"optedOut" in state ? "opt-out" : "snooze"} changed while disabled`, async ({ page }) => {
    await page.goto("/iframe.html?id=upsell-settings--sidebar&viewMode=story")
    await enable(page, true)
    await page.getByRole("button", { name: "Toggle turn", exact: true }).click()
    await expect(card(page)).toHaveAttribute("aria-hidden", "false")
    await expect
      .poll(async () => (await requests(page)).filter((message) => message.action === "rendered").length)
      .toBe(1)
    await enable(page, false)
    await expect(card(page)).toHaveCount(0)
    await page.evaluate((state) => localStorage.setItem("upsell.policy", JSON.stringify(state)), state)
    await enable(page, true)
    await expect(card(page)).toHaveCount(0)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("upsell.policy") ?? "{}"))).toEqual(state)
  })
}

for (const surface of ["editor", "manager"]) {
  test(`opt-in never requests an invitation from the actual ${surface} ChatView`, async ({ page }) => {
    await page.goto(`/iframe.html?id=upsell-settings--${surface}&viewMode=story`)
    await enable(page, true)
    await page.getByRole("button", { name: "Toggle turn", exact: true }).click()
    await expect(page.locator(".chat-view")).toBeVisible()
    await expect(card(page)).toHaveCount(0)
    expect(await requests(page)).toEqual([])
  })
}
