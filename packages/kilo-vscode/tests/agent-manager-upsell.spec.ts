import { expect, test, type Page } from "@playwright/test"
import type { WebviewMessage } from "../webview-ui/src/types/messages"

async function visibility(page: Page, active: boolean) {
  await page.evaluate(async (active) => {
    document.getElementById("storybook-root")!.hidden = !active
    const done = Promise.withResolvers<void>()
    const receive = (event: MessageEvent) => {
      if (event.data.type !== "webviewActiveChanged" || event.data.active !== active) return
      window.removeEventListener("message", receive)
      done.resolve()
    }
    window.addEventListener("message", receive)
    window.postMessage({ type: "webviewActiveChanged", active }, window.location.origin)
    await done.promise
  }, active)
}

test("a retained hidden card reports its impression only once after becoming visible", async ({ page }) => {
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
  await page.goto("/iframe.html?id=chat--chat-agent-manager-upsell&viewMode=story")
  const card = page.locator(".agent-manager-upsell")
  await expect(card).toBeAttached()
  const impressions = () =>
    page.evaluate(() =>
      (window as Window & { upsell: WebviewMessage[] }).upsell.filter(
        (message) => message.type === "telemetry" && message.event === "Agent Manager Upsell",
      ),
    )

  await visibility(page, false)
  await expect(card).toBeHidden()
  expect(await impressions()).toEqual([])

  await visibility(page, true)
  await expect(card).toBeVisible()
  expect(await impressions()).toEqual([
    { type: "telemetry", event: "Agent Manager Upsell", properties: { action: "shown" } },
  ])

  await visibility(page, false)
  await expect(card).toBeHidden()
  await visibility(page, true)
  await expect(card).toBeVisible()
  expect(await impressions()).toHaveLength(1)
})
