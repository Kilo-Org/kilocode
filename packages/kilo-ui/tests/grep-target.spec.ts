import { expect, test } from "@playwright/test"

for (const status of ["pending", "running", "completed"]) {
  test(`grep displays the search target while ${status}`, async ({ page }) => {
    await page.goto("/iframe.html?id=components-messagepart--grep-targets&viewMode=story")

    const rows = page.locator(`[data-status='${status}'] [data-slot='basic-tool-tool-subtitle']`)
    await expect(rows).toHaveText([
      "C:\\Sources pattern=Понятно include=*.cs",
      "C:\\Sources\\Program.cs pattern=Понятно include=*.cs",
      "C:/Sources/ pattern=Понятно include=*.cs",
      "C:\\ pattern=Понятно include=*.cs",
      "\\\\server\\share\\Sources pattern=Понятно include=*.cs",
      "/src pattern=Понятно include=*.cs",
      "/src/index.ts pattern=Понятно include=*.cs",
      "pattern=Понятно include=*.cs",
      "/ pattern=Понятно include=*.cs",
      "src pattern=Понятно include=*.cs",
      "src/nested pattern=Понятно include=*.cs",
      ". pattern=Понятно include=*.cs",
      "pattern=Понятно include=*.cs",
    ])
  })
}
