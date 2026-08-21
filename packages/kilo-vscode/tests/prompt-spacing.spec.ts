import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

async function open(page: Page, id: string, width: number) {
  await page.setViewportSize({ width, height: 720 })
  await page.goto(`/iframe.html?id=${id}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
  await page.waitForSelector(".prompt-input-container")
  await page.evaluate(() => document.fonts.ready)
}

async function spacing(page: Page, selector = ".prompt-input-container") {
  return page.locator(selector).evaluate((el) => {
    const box = el.getBoundingClientRect()
    const host = el.closest(".chat-view, .am-nv-dialog-content")
    if (!(host instanceof HTMLElement)) throw new Error("prompt host missing")
    const parent = host.getBoundingClientRect()
    const style = getComputedStyle(el)
    return {
      left: box.left - parent.left,
      right: parent.right - box.right,
      top: style.marginTop,
      bottom: style.marginBottom,
      gutter: getComputedStyle(host).getPropertyValue("--prompt-gutter").trim(),
    }
  })
}

test.describe("prompt spacing", () => {
  test("uses the minimum gutter in a narrow sidebar chat", async ({ page }) => {
    await open(page, "chat--chat-view-idle", 300)
    const value = await spacing(page)

    expect(value.left).toBeCloseTo(6, 1)
    expect(value.right).toBeCloseTo(6, 1)
    expect(value.top).toBe("6px")
    expect(value.bottom).toBe("6px")
    expect(value.gutter).toBe("max(6px, 2cqi)")
  })

  test("uses the same responsive gutter in Agent Manager chat", async ({ page }) => {
    await open(page, "agentmanager--readable-chat-420", 420)
    const value = await spacing(page)

    expect(value.left).toBeCloseTo(8.4, 1)
    expect(value.right).toBeCloseTo(8.4, 1)
    expect(value.top).toBe("8.4px")
    expect(value.bottom).toBe("8.4px")
    expect(value.gutter).toBe("max(6px, 2cqi)")
  })

  test("keeps the minimum gutter in the New Worktree prompt", async ({ page }) => {
    await open(page, "agentmanager--new-worktree-variant-dropdown-1280", 1280)
    const value = await spacing(page, ".am-prompt-input-container")

    expect(value.left).toBeGreaterThanOrEqual(6)
    expect(value.right).toBeGreaterThanOrEqual(6)
    expect(value.top).toBe("6px")
    expect(value.bottom).toBe("6px")
  })
})
