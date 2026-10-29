import { expect, test } from "@playwright/test"

test("image settings only patch edited fields and clear the model on a source switch", async ({ page }) => {
  await page.goto("/iframe.html?id=settings--custom-images&viewMode=story")
  await page.getByRole("switch", { name: "Batch Tool", exact: true }).press("Space")
  const patch = page.getByTestId("image-settings-patch")
  await expect(patch).toHaveText(JSON.stringify({ experimental: { batch_tool: true } }))
  await page.getByPlaceholder("http://127.0.0.1:8080/v1").fill("")
  await expect(patch).toHaveText(JSON.stringify({ experimental: { image_generation_model: null } }))
})
