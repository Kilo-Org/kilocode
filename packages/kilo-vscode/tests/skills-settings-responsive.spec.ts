import { expect, test, type Locator, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const STORY_ID = "settings--agent-behaviour-skills-overflow"

const SEEDED_PATH = "/home/user/projects/very-long-directory-name/skills-collection/team-shared"
const SEEDED_PATH_2 = "./relative/path/to/skills/another/very/long/nested/directory"
const SEEDED_URL = "https://example.com/very/long/path/to/skills/registry/index.json?ref=main&token=abc123"
const SEEDED_URL_2 = "https://other.example.org/skills/v2/registry.json?namespace=team&version=latest"

function overflowFixture(page: Page) {
  return page.goto(`/iframe.html?id=${STORY_ID}&viewMode=story&globals=${GLOBALS}`, {
    waitUntil: "load",
  })
}

function cardFor(loc: Locator) {
  return loc.locator("xpath=following-sibling::div[@data-component='card'][1]")
}

async function assertRowContained(row: Locator, card: Locator, label: string) {
  const rowBox = await row.boundingBox()
  const cardBox = await card.boundingBox()
  expect(rowBox, `${label}: row bounding box`).not.toBeNull()
  expect(cardBox, `${label}: card bounding box`).not.toBeNull()
  expect(rowBox!.width, `${label}: row width <= card width (no horizontal overflow)`).toBeLessThanOrEqual(
    cardBox!.width + 1,
  )
  expect(rowBox!.x, `${label}: row left edge inside card`).toBeGreaterThanOrEqual(cardBox!.x - 1)
  expect(rowBox!.x + rowBox!.width, `${label}: row right edge inside card`).toBeLessThanOrEqual(
    cardBox!.x + cardBox!.width + 1,
  )
}

test.describe("skills settings responsive layout", () => {
  test("folder-path and URL rows stay contained and the × button remains visible at a narrow viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 720 })
    await overflowFixture(page)

    const pathsHeader = page.getByRole("heading", { name: "Skill Folder Paths" })
    const urlsHeader = page.getByRole("heading", { name: "Skill URLs" })
    await expect(pathsHeader).toBeVisible()
    await expect(urlsHeader).toBeVisible()

    const pathsCard = cardFor(pathsHeader)
    const urlsCard = cardFor(urlsHeader)
    await expect(pathsCard).toBeVisible()
    await expect(urlsCard).toBeVisible()

    for (const seeded of [SEEDED_PATH, SEEDED_PATH_2]) {
      const span = page.getByText(seeded, { exact: true })
      await expect(span, `path value visible: ${seeded}`).toBeVisible()
      const trigger = span.locator("xpath=ancestor::div[@data-component='tooltip-trigger'][1]")
      await expect(trigger, `path Tooltip trigger wraps the value: ${seeded}`).toBeVisible()
      const row = trigger.locator("xpath=parent::div")
      await assertRowContained(row, pathsCard, `Skill Folder Paths row "${seeded}"`)

      const closeButton = row.locator('[data-icon="close"]')
      await expect(closeButton, "× button is visible").toBeVisible()
      const btnBox = await closeButton.boundingBox()
      const cardBox = await pathsCard.boundingBox()
      expect(btnBox, "× button bounding box").not.toBeNull()
      expect(btnBox!.x + btnBox!.width, "× button right edge inside card (not pushed off-screen)").toBeLessThanOrEqual(
        cardBox!.x + cardBox!.width + 1,
      )

      // The full path is always in the DOM — the ellipsis is visual-only, so
      // screen readers read the complete value without any interaction. The
      // Tooltip still adds a hover affordance for mouse users so the full
      // path is visible without resizing.
      await trigger.hover()
      const content = page.locator('[data-component="tooltip"]').filter({ hasText: seeded })
      await expect(content, `Kilo Tooltip exposes full path on hover: ${seeded}`).toBeVisible()
    }

    for (const seeded of [SEEDED_URL, SEEDED_URL_2]) {
      const span = page.getByText(seeded, { exact: true })
      await expect(span, `URL value visible: ${seeded}`).toBeVisible()
      const trigger = span.locator("xpath=ancestor::div[@data-component='tooltip-trigger'][1]")
      await expect(trigger, `URL Tooltip trigger wraps the value: ${seeded}`).toBeVisible()
      const row = trigger.locator("xpath=parent::div")
      await assertRowContained(row, urlsCard, `Skill URLs row "${seeded}"`)

      const closeButton = row.locator('[data-icon="close"]')
      await expect(closeButton, "× button is visible").toBeVisible()
      const btnBox = await closeButton.boundingBox()
      const cardBox = await urlsCard.boundingBox()
      expect(btnBox, "× button bounding box").not.toBeNull()
      expect(btnBox!.x + btnBox!.width, "× button right edge inside card (not pushed off-screen)").toBeLessThanOrEqual(
        cardBox!.x + cardBox!.width + 1,
      )

      // The full URL is always in the DOM — the ellipsis is visual-only, so
      // screen readers read the complete value without any interaction. The
      // Tooltip still adds a hover affordance for mouse users so the full
      // URL is visible without resizing.
      await trigger.hover()
      const content = page.locator('[data-component="tooltip"]').filter({ hasText: seeded })
      await expect(content, `Kilo Tooltip exposes full URL on hover: ${seeded}`).toBeVisible()
    }

    for (const [label, card] of [
      ["Skill Folder Paths", pathsCard],
      ["Skill URLs", urlsCard],
    ] as const) {
      const add = card.getByRole("button", { name: "Add", exact: true })
      await expect(add, `Add button visible inside ${label} card`).toBeVisible()
      const addBox = await add.boundingBox()
      const cardBox = await card.boundingBox()
      expect(addBox, "Add button bounding box").not.toBeNull()
      expect(addBox!.x + addBox!.width, `Add button right edge inside ${label} card`).toBeLessThanOrEqual(
        cardBox!.x + cardBox!.width + 1,
      )
    }
  })
})
