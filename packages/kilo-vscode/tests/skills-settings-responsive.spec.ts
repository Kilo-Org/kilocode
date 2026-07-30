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

async function parentCard(loc: Locator) {
  return loc.locator("xpath=ancestor::div[@data-component='card'][1]")
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

    const pathsCard = await parentCard(pathsHeader)
    const urlsCard = await parentCard(urlsHeader)
    await expect(pathsCard).toBeVisible()
    await expect(urlsCard).toBeVisible()

    for (const seeded of [SEEDED_PATH, SEEDED_PATH_2]) {
      const span = page.getByText(seeded, { exact: true })
      await expect(span, `path value visible: ${seeded}`).toBeVisible()
      const row = span.locator("xpath=parent::div")
      await assertRowContained(row, pathsCard, `Skill Folder Paths row "${seeded}"`)

      const closeButton = row.locator('[data-icon="close"]')
      await expect(closeButton, "× button is visible").toBeVisible()
      const btnBox = await closeButton.boundingBox()
      const cardBox = await pathsCard.boundingBox()
      expect(btnBox, "× button bounding box").not.toBeNull()
      expect(btnBox!.x + btnBox!.width, "× button right edge inside card (not pushed off-screen)").toBeLessThanOrEqual(
        cardBox!.x + cardBox!.width + 1,
      )
    }

    for (const seeded of [SEEDED_URL, SEEDED_URL_2]) {
      const span = page.getByText(seeded, { exact: true })
      await expect(span, `URL value visible: ${seeded}`).toBeVisible()
      const row = span.locator("xpath=parent::div")
      await assertRowContained(row, urlsCard, `Skill URLs row "${seeded}"`)

      const closeButton = row.locator('[data-icon="close"]')
      await expect(closeButton, "× button is visible").toBeVisible()
      const btnBox = await closeButton.boundingBox()
      const cardBox = await urlsCard.boundingBox()
      expect(btnBox, "× button bounding box").not.toBeNull()
      expect(btnBox!.x + btnBox!.width, "× button right edge inside card (not pushed off-screen)").toBeLessThanOrEqual(
        cardBox!.x + cardBox!.width + 1,
      )
    }

    for (const addLabel of ["Add"]) {
      const add = urlsCard.getByRole("button", { name: addLabel, exact: true })
      await expect(add, `Add button (${addLabel}) visible inside URLs card`).toBeVisible()
      const addBox = await add.boundingBox()
      const cardBox = await urlsCard.boundingBox()
      expect(addBox, "Add button bounding box").not.toBeNull()
      expect(addBox!.x + addBox!.width, `Add button (${addLabel}) right edge inside card`).toBeLessThanOrEqual(
        cardBox!.x + cardBox!.width + 1,
      )
    }
  })
})
