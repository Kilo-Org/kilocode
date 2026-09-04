import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

async function open(page: Page) {
  await page.goto(`/iframe.html?id=prompt-input--default-420&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
  const input = page.locator("textarea.prompt-input")
  await expect(input).toBeVisible()
  await page.evaluate(() => window.postMessage({ type: "connectionState", state: "connected" }, window.origin))
  await expect(input).toBeEnabled()
  return input
}

async function observe(page: Page, block = false) {
  const trace = await page.evaluateHandle((block) => {
    const events: KeyboardEvent[] = []
    const forwarded: KeyboardEvent[] = []
    window.addEventListener("keydown", (event) => {
      if (event.key.length !== 1) return
      forwarded.push(event)
      if (block) event.preventDefault()
    })
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key.length === 1) events.push(event)
      },
      true,
    )
    return { events, forwarded }
  }, block)
  return () =>
    trace.evaluate((state) => ({
      prevented: state.events.splice(0).map((event) => event.defaultPrevented),
      forwarded: state.forwarded.splice(0).map((event) => event.key),
    }))
}

test("native undo and redo stay local despite host key forwarding", async ({ page }) => {
  const input = await open(page)
  await input.pressSequentially("Draft text")
  await expect(input).toHaveValue("Draft text")
  const read = await observe(page, true)

  await input.press("ControlOrMeta+z")
  await expect(input).toHaveValue("")
  expect(await read()).toEqual({ prevented: [false], forwarded: [] })

  await input.press("ControlOrMeta+Shift+Z")
  await expect(input).toHaveValue("Draft text")
  expect(await read()).toEqual({ prevented: [false], forwarded: [] })
})

test("only supported history chords stop propagation without cancelling text defaults", async ({ page }) => {
  const input = await open(page)
  await input.pressSequentially("Draft text")
  const read = await observe(page)

  for (const modifier of ["Control", "Meta"]) {
    for (const chord of ["z", "Shift+Z", "y"]) {
      await input.press(`${modifier}+${chord}`)
      expect(await read(), `${modifier}+${chord}`).toEqual({ prevented: [false], forwarded: [] })
    }
    for (const chord of ["c", "x", "v", "Alt+z", "Alt+Shift+Z", "Alt+y", "Shift+Y"]) {
      await input.dispatchEvent("keydown", {
        key: chord.split("+").at(-1),
        ctrlKey: modifier === "Control",
        metaKey: modifier === "Meta",
        altKey: chord.includes("Alt"),
        shiftKey: chord.includes("Shift"),
      })
      expect(await read(), `${modifier}+${chord}`).toEqual({
        prevented: [false],
        forwarded: [chord.split("+").at(-1)],
      })
    }
  }
})

test("enhanced prompt undo restores the original without reaching the host", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "acquireVsCodeApi", {
      value: () => ({
        getState: () => undefined,
        setState: () => undefined,
        postMessage: (message: { type: string; requestId?: string }) => {
          if (message.type !== "enhancePrompt") return
          window.postMessage(
            { type: "enhancePromptResult", requestId: message.requestId, text: "Enhanced draft" },
            window.origin,
          )
        },
      }),
    })
  })
  const input = await open(page)
  await input.pressSequentially("Original draft")
  await page.getByRole("button", { name: "Enhance prompt", exact: true }).click()
  await expect(input).toHaveValue("Enhanced draft")
  const read = await observe(page, true)

  await input.press("ControlOrMeta+z")
  await expect(input).toHaveValue("Original draft")
  expect(await read()).toEqual({ prevented: [true], forwarded: [] })
})
