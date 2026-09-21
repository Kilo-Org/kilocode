import { expect, test, type Page } from "@playwright/test"
import { VSCODE_THEMES } from "../src/stories/vscode-themes"

async function check(page: Page, width: number, globals: string) {
  await page.setViewportSize({ width, height: 720 })
  await page.goto(`/iframe.html?id=components-diff--default&viewMode=story&globals=${globals}`)

  const diff = page.locator("[data-diff]").first()
  await expect(diff).toBeVisible()
  await expect(diff).toHaveAttribute("data-indicators", "bars")
  if (width < 640) await expect(diff).toHaveAttribute("data-disable-line-numbers", "")
  if (width > 640) await expect(diff).not.toHaveAttribute("data-disable-line-numbers", "")

  for (const type of ["deletion", "addition"]) {
    const gutter = page.locator(`[data-column-number][data-line-type='change-${type}']`).first()
    await expect(gutter).toBeVisible()
    await expect.poll(() => gutter.evaluate((element) => getComputedStyle(element, "::before").width)).toBe("4px")
    await expect.poll(() => gutter.evaluate((element) => getComputedStyle(element, "::before").opacity)).toBe("1")
    await expect.poll(() => gutter.evaluate((element) => getComputedStyle(element, "::before").height)).not.toBe("0px")
    await expect.poll(() => gutter.evaluate((element) => getComputedStyle(element, "::before").content)).toBe('""')
    if (type === "deletion") {
      await expect
        .poll(() => gutter.evaluate((element) => getComputedStyle(element, "::before").backgroundImage))
        .not.toBe("none")
      const context = page.locator("[data-column-number][data-line-type='context']").first()
      await expect(context).toBeVisible()
      await expect
        .poll(() =>
          gutter.evaluate((deletion) => {
            const root = deletion.getRootNode() as ShadowRoot
            const context = root.querySelector("[data-column-number][data-line-type='context']")
            if (!deletion || !context) return false
            const contextStyle = getComputedStyle(context)
            const color = contextStyle.color || getComputedStyle((context.getRootNode() as ShadowRoot).host).color
            return Boolean(color) && getComputedStyle(deletion).color === color
          }),
        )
        .toBe(true)
      await expect
        .poll(() =>
          gutter.evaluate((deletion) => {
            return getComputedStyle(deletion).getPropertyValue("--diffs-fg-number-deletion-override").trim()
          }),
        )
        .not.toBe("")
    }
  }
}

for (const scheme of ["light", "dark"] as const) {
  for (const width of [420, 1000]) {
    test(`diff bars in ${scheme} theme at ${width}px`, async ({ page }) => {
      await check(page, width, `colorScheme:${scheme}`)
    })
  }
}

for (const [theme] of Object.entries(VSCODE_THEMES)) {
  for (const width of [420, 1000]) {
    test(`neutral deleted numbers in VS Code ${theme} at ${width}px`, async ({ page }) => {
      await check(page, width, `theme:kilo-vscode;vscodeTheme:${theme}`)
    })
  }
}
