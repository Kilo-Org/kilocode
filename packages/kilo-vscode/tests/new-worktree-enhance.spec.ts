import { expect, test, type Page } from "@playwright/test"

type Sent = { type: string; text?: string; requestId?: string }

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

// Opens the real New Worktree dialog with a host that records Enhance messages and never answers.
async function open(page: Page) {
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
  await page.goto(`/iframe.html?id=agentmanager--new-worktree-prompt&viewMode=story&globals=${GLOBALS}`, {
    waitUntil: "load",
  })
  const input = page.locator("textarea.am-prompt-input")
  await expect(input).toBeVisible()
  await page.evaluate(() => window.postMessage({ type: "connectionState", state: "connected" }, window.origin))
  const sent = () => page.evaluate(() => (window as unknown as { __enhance: Sent[] }).__enhance.slice())
  const reply = (message: Record<string, string | undefined>) =>
    page.evaluate((message) => window.postMessage(message, window.origin), message)
  return { input, sent, reply }
}

test("clicking Enhance again stops the request and a late result is ignored", async ({ page }) => {
  const dialog = await open(page)
  await dialog.input.fill("Original draft")
  await page.getByRole("button", { name: "Enhance prompt", exact: true }).click()
  await page.getByRole("button", { name: "Stop enhancing", exact: true }).click()

  const id = (await dialog.sent()).at(0)?.requestId
  expect(await dialog.sent()).toEqual([
    { type: "enhancePrompt", text: "Original draft", requestId: id },
    { type: "cancelEnhancePrompt", requestId: id },
  ])
  await dialog.reply({ type: "enhancePromptResult", requestId: id, text: "Late result" })
  await expect(dialog.input).toHaveValue("Original draft")
  await expect(page.getByRole("button", { name: "Enhance prompt", exact: true })).toBeEnabled()
})

test("an edit while enhancing stops the request in the host too", async ({ page }) => {
  const dialog = await open(page)
  await dialog.input.fill("Original draft")
  await page.getByRole("button", { name: "Enhance prompt", exact: true }).click()
  await dialog.input.pressSequentially(" with my edits")

  const id = (await dialog.sent()).at(0)?.requestId
  expect((await dialog.sent()).at(-1)).toEqual({ type: "cancelEnhancePrompt", requestId: id })
  await dialog.reply({ type: "enhancePromptResult", requestId: id, text: "Late result" })
  await expect(dialog.input).toHaveValue("Original draft with my edits")
})
