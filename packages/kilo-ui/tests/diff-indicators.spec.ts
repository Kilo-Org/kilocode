import { expect, test } from "@playwright/test"

for (const scheme of ["light", "dark"]) {
  for (const width of [420, 1000]) {
    test(`diff bars in ${scheme} theme at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 })
      await page.goto(`/iframe.html?id=components-diff--default&viewMode=story&globals=colorScheme:${scheme}`)

      const diff = page.locator("[data-diff]").first()
      await expect(diff).toBeVisible()
      if (width < 640) await expect(diff).toHaveAttribute("data-disable-line-numbers", "")
      if (width > 640) await expect(diff).not.toHaveAttribute("data-disable-line-numbers", "")

      for (const type of ["deletion", "addition"]) {
        const gutter = page.locator(`[data-column-number][data-line-type='change-${type}']`).first()
        await expect(gutter).toBeVisible()
        const bar = await gutter.evaluate((element) => {
          const style = getComputedStyle(element, "::before")
          return {
            width: parseFloat(style.width),
            opacity: style.opacity,
            height: parseFloat(style.height),
            content: style.content,
            base: getComputedStyle(element).getPropertyValue("--diffs-deletion-base").trim(),
          }
        })
        expect(bar.width).toBe(4)
        expect(bar.opacity).toBe("1")
        expect(bar.height).toBeGreaterThan(0)
        expect(bar.content).toBe('""')
        if (type === "deletion") expect(bar.base).not.toBe(scheme === "dark" ? "#ff6762" : "#ff2e3f")
      }
    })
  }
}
