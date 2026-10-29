import { expect, test } from "@playwright/test"

test("image settings only patch edited fields and clear the model on a source switch", async ({ page }) => {
  await page.goto("/iframe.html?id=settings--custom-images&viewMode=story")
  await page.getByRole("switch", { name: "Batch Tool", exact: true }).press("Space")
  const patch = page.getByTestId("image-settings-patch")
  await expect(patch).toHaveText(JSON.stringify({ experimental: { batch_tool: true } }))
  await page.getByPlaceholder("http://127.0.0.1:8080/v1").fill("")
  await expect(patch).toHaveText(JSON.stringify({ experimental: { image_generation_model: null } }))
})

test("model discovery ignores stale replies and leaves manual entry available", async ({ page }) => {
  await page.clock.install()
  await page.goto("/iframe.html?id=settings--custom-images&viewMode=story")
  const model = page.getByRole("textbox", { name: "Image Model", exact: true })
  await expect(model).toHaveValue("Qwen-Image-2.1")
  await page.evaluate(() =>
    window.postMessage(
      {
        type: "imageModelsLoaded",
        request: 1,
        models: [{ id: "Qwen-Image-2.1", name: "Gufo model" }],
      },
      "*",
    ),
  )
  await expect(page.getByRole("button", { name: "Gufo model" })).toBeVisible()
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await page.evaluate(() => {
    window.postMessage({ type: "imageModelsLoaded", request: 2, models: [], error: "Server offline" }, "*")
    window.postMessage({ type: "imageModelsLoaded", request: 1, models: [{ id: "stale", name: "Stale model" }] }, "*")
  })
  await expect(page.getByText(/Server offline/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Stale model" })).toHaveCount(0)
  await model.fill("manual-model")
  await expect(model).toHaveValue("manual-model")
  await page.getByPlaceholder("http://127.0.0.1:8080/v1").fill("http://localhost:9000/v1")
  await expect(page.getByText("Save the endpoint settings to discover its models.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled()
})
