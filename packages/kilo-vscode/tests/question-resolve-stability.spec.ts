import { expect, test, type Page } from "@playwright/test"

/**
 * A question tool part resolves before it completes: the backend publishes
 * question.replied first, then the tool result lands. The webview therefore
 * drops the live request while the tool part still reports `running`, and the
 * inline QuestionDock used to unmount in that gap. The row collapsed to nothing
 * for a frame, then the answered card appeared: the transcript flickered.
 *
 * The story drives both phases and the test asserts the row keeps its geometry
 * until the completed card can take over.
 */

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const STORY_ID = "labs-tool-call-lab--question-resolve-stability"
const ROW = '[data-part-id="matrix-question-resolve-part"]'

async function openStory(page: Page) {
  await page.setViewportSize({ width: 720, height: 640 })
  await page.goto(`/iframe.html?id=${STORY_ID}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
  // Geometry assertions need settled layout, so motion is off.
  await page.addStyleTag({
    content: `*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }`,
  })
  await page.waitForSelector('[data-component="question-dock"]')
  await page.evaluate(() => document.fonts.ready)
}

async function geometry(page: Page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return page.evaluate((selector) => {
    const row = document.querySelector(selector)
    if (!(row instanceof HTMLElement)) throw new Error("question row missing")
    const box = row.getBoundingClientRect()
    return { top: box.top, height: box.height }
  }, ROW)
}

test("the question dock stays mounted between resolve and completion", async ({ page }) => {
  await openStory(page)
  const dock = page.locator('[data-component="question-dock"]')
  await expect(dock).toBeVisible()
  const asked = await geometry(page)

  // The request is gone but the tool part has not completed yet. The dock must
  // stay in place rather than collapsing the row for a frame.
  await page.getByTestId("resolve-question").click()
  await expect(dock).toBeVisible()
  const resolved = await geometry(page)
  expect(resolved).toEqual(asked)

  // Once the part completes, the answered card replaces the dock.
  await page.getByTestId("complete-question").click()
  await expect(dock).toBeHidden()
  await expect(page.locator('[data-component="question-answers"]')).toBeVisible()
})
