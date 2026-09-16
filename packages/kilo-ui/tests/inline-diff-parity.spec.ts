import { expect, test } from "@playwright/test"

// The inline edit card in the transcript must render with the same Pierre
// options as the dedicated diff viewer: gutter bars, the Kilo deletion bar
// color, and eager rendering. Word-level highlighting is decided by the worker
// pool, which Storybook does not run with the Kilo worker, so it is not
// asserted here. The virtualizer fallback for oversized files is covered by
// src/pierre/virtualize.test.ts.
test("inline edit diff matches the diff viewer options", async ({ page }) => {
  await page.goto(
    "/iframe.html?id=components-messagepart--with-edit-tool-open-diff-action&viewMode=story&globals=colorScheme:dark",
  )

  const trigger = page.locator("[data-component='edit-tool'] [data-component='tool-trigger']").first()
  await expect(trigger).toBeVisible()
  await trigger.click()

  const diff = page.locator("[data-component='edit-content'] [data-diff]").first()
  await expect(diff).toBeVisible()
  await expect(diff).toHaveAttribute("data-indicators", "bars")

  // A hunk-bounded diff must not line-virtualize. Eager rendering keeps the
  // same Pierre instance, which is what stops the card resetting as it streams.
  await expect(page.locator("[data-component='edit-content'] [data-line]").first()).toBeAttached()
  await expect(page.locator("[data-component='edit-content'] [data-virtualizer-buffer]")).toHaveCount(0)

  const deletion = page.locator("[data-column-number][data-line-type='change-deletion']").first()
  await expect(deletion).toBeVisible()
  await expect
    .poll(() => deletion.evaluate((element) => getComputedStyle(element, "::before").backgroundImage))
    .not.toBe("none")
  // Only the Kilo Pierre CSS defines this override, so it proves the inline
  // card shares the diff viewer stylesheet.
  await expect
    .poll(() =>
      deletion.evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--diffs-fg-number-deletion-override").trim(),
      ),
    )
    .not.toBe("")
})
