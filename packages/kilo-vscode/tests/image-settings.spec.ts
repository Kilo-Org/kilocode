import { expect, test } from "@playwright/test"

test("image settings only patch edited fields and clear the model on a source switch", async ({ page }) => {
  await page.goto("/iframe.html?id=settings--custom-images&viewMode=story")
  await page.getByRole("switch", { name: "Batch Tool", exact: true }).press("Space")
  const patch = page.getByTestId("image-settings-patch")
  await expect(patch).toHaveText(JSON.stringify({ experimental: { batch_tool: true } }))
  const seed = page.getByRole("spinbutton", { name: "Image seed", exact: true })
  await seed.fill("0")
  await expect(patch).toHaveText(JSON.stringify({ experimental: { image_generation_options: { seed: 0 } } }))
  await seed.fill("-1")
  await expect(seed).toHaveValue("-1")
  await expect(seed).toHaveAttribute("aria-invalid", "true")
  await expect(
    page.getByText("Enter a whole number from 0 to 9007199254740991. Invalid values are not saved."),
  ).toBeVisible()
  await expect(patch).toHaveText(JSON.stringify({ experimental: { image_generation_options: { seed: 0 } } }))
  await seed.fill("")
  await expect(seed).not.toHaveAttribute("aria-invalid", "true")
  await expect(patch).toHaveText(JSON.stringify({ experimental: { image_generation_options: { seed: null } } }))
  const steps = page.getByRole("spinbutton", { name: "Image steps", exact: true })
  await steps.fill("20")
  await expect(patch).toHaveText(JSON.stringify({ experimental: { image_generation_options: { steps: 20 } } }))
  for (const value of ["0", "1.5", "9007199254740992"]) {
    await steps.fill(value)
    await expect(steps).toHaveAttribute("aria-invalid", "true")
    await expect(patch).toHaveText(JSON.stringify({ experimental: { image_generation_options: { steps: 20 } } }))
  }
  await steps.fill("20")
  const size = page.getByRole("textbox", { name: "Image size", exact: true })
  await size.fill("1024x")
  await expect(
    page.getByText("Enter auto or positive dimensions such as 1024x1024. Invalid values are not saved."),
  ).toBeVisible()
  await expect(patch).toHaveText(JSON.stringify({ experimental: { image_generation_options: { steps: 20 } } }))
  await size.fill("1024x1024")
  await expect(size).not.toHaveAttribute("aria-invalid", "true")
  await expect(patch).toHaveText(JSON.stringify({ experimental: { image_generation_options: { size: "1024x1024" } } }))

  const endpoint = page.getByPlaceholder("http://127.0.0.1:8080/v1")
  await endpoint.fill(" http://127.0.0.1:8080/v1/ ")
  await expect(patch).toHaveText(
    JSON.stringify({ experimental: { image_generation_base_url: "http://127.0.0.1:8080/v1/" } }),
  )
  await expect(page.getByRole("textbox", { name: "Image Model", exact: true })).toHaveValue("Qwen-Image-2.1")
  await endpoint.fill("http://localhost:9000/v1")
  await expect(patch).toHaveText(
    JSON.stringify({
      experimental: { image_generation_base_url: "http://localhost:9000/v1", image_generation_model: null },
    }),
  )
  await expect(page.getByRole("textbox", { name: "Image Model", exact: true })).toHaveValue("")
  await endpoint.fill("")
  await expect(patch).toHaveText(
    JSON.stringify({ experimental: { image_generation_base_url: null, image_generation_model: null } }),
  )
})

test("model discovery ignores stale replies and leaves manual entry available", async ({ page }) => {
  await page.clock.install()
  await page.goto("/iframe.html?id=settings--custom-images&viewMode=story")
  const model = page.getByRole("textbox", { name: "Image Model", exact: true })
  await expect(model).toHaveValue("Qwen-Image-2.1")
  await page.evaluate(() => window.postMessage({ type: "extensionDataReady" }, "*"))
  await page.clock.fastForward(4000)
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
  await page.evaluate(() => window.postMessage({ type: "extensionDataReady" }, "*"))
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled()
  await page.evaluate(() =>
    window.postMessage(
      { type: "imageModelsLoaded", request: 3, models: [{ id: "Qwen-Image-2.1", name: "Gufo model" }] },
      "*",
    ),
  )
  await expect(page.getByRole("button", { name: "Gufo model" })).toBeVisible()
  await model.fill("manual-model")
  await expect(model).toHaveValue("manual-model")
  await page.getByPlaceholder("http://127.0.0.1:8080/v1").fill("http://localhost:9000/v1")
  await expect(page.getByText("Save the endpoint settings to discover its models.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled()
})
