import { expect, test, type Page } from "@playwright/test"
import { open } from "./helpers/prompt-input"

type Sent = { type: string; requestId?: string }

// Records Enhance requests and leaves them pending, so each test decides when the host answers.
async function host(page: Page) {
  await page.addInitScript(() => {
    const sent: Sent[] = []
    Object.defineProperty(window, "__enhance", { value: sent })
    Object.defineProperty(window, "acquireVsCodeApi", {
      value: () => ({
        getState: () => undefined,
        setState: () => undefined,
        postMessage: (message: Sent) => {
          if (message.type === "enhancePrompt" || message.type === "cancelEnhancePrompt") sent.push(message)
        },
      }),
    })
  })
  const sent = () => page.evaluate(() => (window as unknown as { __enhance: Sent[] }).__enhance.slice())
  const reply = (message: Record<string, string | undefined>) =>
    page.evaluate((message) => window.postMessage(message, window.origin), message)
  return { sent, reply }
}

test("clicking Enhance again stops the request and a late result is ignored", async ({ page }) => {
  const api = await host(page)
  const input = await open(page)
  await input.pressSequentially("Original draft")
  await page.getByRole("button", { name: "Enhance prompt", exact: true }).click()
  await page.getByRole("button", { name: "Stop enhancing", exact: true }).click()

  const first = (await api.sent()).at(0)?.requestId
  expect(await api.sent()).toEqual([
    { type: "enhancePrompt", text: "Original draft", requestId: first },
    { type: "cancelEnhancePrompt", requestId: first },
  ])
  await api.reply({ type: "enhancePromptResult", requestId: first, text: "Late result" })
  await expect(input).toHaveValue("Original draft")
  await expect(input).toBeEditable()

  await page.getByRole("button", { name: "Enhance prompt", exact: true }).click()
  const second = (await api.sent()).at(-1)?.requestId
  expect(second).not.toBe(first)
  await api.reply({ type: "enhancePromptResult", requestId: second, text: "Enhanced draft" })
  await expect(input).toHaveValue("Enhanced draft")
})

test("edits made while enhancing are kept when the result arrives", async ({ page }) => {
  const api = await host(page)
  const input = await open(page)
  await input.pressSequentially("Original draft")
  await page.getByRole("button", { name: "Enhance prompt", exact: true }).click()
  await input.pressSequentially(" with my edits")

  const id = (await api.sent()).at(0)?.requestId
  expect((await api.sent()).at(-1)).toEqual({ type: "cancelEnhancePrompt", requestId: id })
  await api.reply({ type: "enhancePromptResult", requestId: id, text: "Late result" })
  await expect(input).toHaveValue("Original draft with my edits")
  await expect(page.getByRole("button", { name: "Enhance prompt", exact: true })).toBeEnabled()
})

test("a failed enhancement keeps the draft and can be retried", async ({ page }) => {
  const api = await host(page)
  const input = await open(page)
  await input.pressSequentially("Original draft")
  await page.getByRole("button", { name: "Enhance prompt", exact: true }).click()
  const first = (await api.sent()).at(0)?.requestId
  await api.reply({ type: "enhancePromptError", requestId: first, error: "Network error" })
  await expect(input).toHaveValue("Original draft")

  await page.getByRole("button", { name: "Enhance prompt", exact: true }).click()
  const second = (await api.sent()).at(-1)?.requestId
  expect(second).not.toBe(first)
  await api.reply({ type: "enhancePromptResult", requestId: second, text: "Enhanced draft" })
  await expect(input).toHaveValue("Enhanced draft")
  await input.press("ControlOrMeta+z")
  await expect(input).toHaveValue("Original draft")
})
