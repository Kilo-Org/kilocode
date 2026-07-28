import { expect, test } from "@playwright/test"

test("renders Mermaid from delimiter-free Markdown source", async ({ page }) => {
  await page.goto("/iframe.html?id=shared--markdown-mermaid&viewMode=story")

  const markdown = page.locator('[data-component="markdown"]')
  await expect(markdown.getByRole("heading", { name: "Flow" })).toBeVisible()
  const diagram = markdown.locator('[data-mermaid-state="rendered"]')
  await expect(diagram.locator('svg[aria-roledescription="flowchart-v2"]')).toBeVisible()

  const source = diagram.locator('code[data-lang="mermaid"]')
  await expect(source).toContainText("flowchart TD")
  await expect(source).not.toContainText("```mermaid")
  await expect(markdown.getByText("Rendered after the diagram.")).toBeVisible()
})
