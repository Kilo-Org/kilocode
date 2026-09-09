import { expect, test, type Page } from "@playwright/test"
import type { SessionBoard, WebviewMessage } from "../webview-ui/src/types/messages"

type Request = Extract<WebviewMessage, { type: "requestSessionBoard" | "resetSessionBoard" }>
const board: SessionBoard = {
  ownerSessionID: "story-session-chat-001",
  revision: 2,
  hasMore: false,
  messages: [
    { id: "old", timestamp: 1, from: "main", to: "ses_peer", toLabel: "Agent", type: "INFO", body: "Older message" },
    {
      id: "new",
      timestamp: 2,
      from: "ses_peer",
      fromLabel: "Agent",
      to: "ALL",
      type: "RESULT",
      body: "Newer **formatted** text with `code`.",
    },
  ],
}
const empty = { ...board, messages: [] }

async function result(page: Page, request: Request, value = board, error?: string) {
  await page.evaluate((message) => window.postMessage(message, "*"), {
    type: "sessionBoardLoaded",
    sessionID: request.sessionID,
    requestID: request.requestID,
    projectId: request.projectId,
    board: value,
    error,
  })
}

async function change(page: Page, detail: Record<string, unknown>) {
  await page.evaluate((value) => window.dispatchEvent(new CustomEvent("swarmStoryChange", { detail: value })), detail)
}

async function jobs(page: Page, status?: "running" | "completed") {
  await page.evaluate((message) => window.postMessage(message, "*"), {
    type: "backgroundJobsLoaded",
    sessionID: board.ownerSessionID,
    requestID: "activity",
    jobs: status ? [{ id: "job", type: "task", status, started_at: 1 }] : [],
  })
}

async function setup(page: Page, initial = board) {
  const calls: Request[] = []
  await page.exposeFunction("record", (message: Request) => calls.push(message))
  await page.addInitScript(() => {
    const record = (window as unknown as { record: (message: Request) => void }).record
    Object.defineProperty(window, "acquireVsCodeApi", {
      value: () => ({
        getState: () => undefined,
        setState: () => {},
        postMessage: (message: WebviewMessage) => {
          if (message.type === "requestSessionBoard" || message.type === "resetSessionBoard") record(message)
        },
      }),
    })
  })
  await page.goto(
    "/iframe.html?id=chat--board-closed&viewMode=story&manual=1&globals=colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern",
  )
  const toggle = page.getByRole("button", { name: "Board", exact: true })
  const current = async (count: number) => {
    await expect.poll(() => calls.length).toBe(count)
    return calls.at(-1)!
  }
  const peek = await current(1)
  expect(peek).toMatchObject({ type: "requestSessionBoard", limit: 1 })
  await expect(toggle).toHaveCount(0)
  await result(page, peek, { ...initial, messages: initial.messages.slice(-1), hasMore: initial.messages.length > 1 })
  if (initial.messages.length) await expect(toggle).toBeVisible()
  return { calls, toggle, current, peek }
}

test("hides empty boards and discovers the first async message without polling idle sessions", async ({ page }) => {
  const scene = await setup(page, empty)
  await expect(scene.toggle).toHaveCount(0)
  await expect(page.locator(".task-board")).toHaveCount(0)
  await expect(page.getByText("No board messages.", { exact: true })).toHaveCount(0)
  await jobs(page)
  expect(scene.calls).toHaveLength(1)
  await jobs(page, "running")
  const peek = await scene.current(2)
  expect(peek).toMatchObject({ limit: 1 })
  await result(page, peek)
  await expect(scene.toggle).toBeVisible()
  await expect(page.locator(".task-board")).toHaveCount(0)
  await jobs(page, "running")
  expect(scene.calls).toHaveLength(2)
})

test("uses a distinct icon and fills short histories without manual paging", async ({ page }) => {
  const scene = await setup(page)
  await expect(page.locator('[data-slot="task-header-stats"] [aria-label="Board"]')).toBeVisible()
  await expect(page.locator(".task-board")).toHaveCount(0)
  const icon = await scene.toggle.locator("svg").innerHTML()
  await scene.toggle.click()
  const request = await scene.current(2)
  expect(request).toMatchObject({ limit: 50 })
  await expect(page.getByRole("dialog", { name: "Board", exact: true })).toBeVisible()
  await result(page, request, { ...board, hasMore: true, cursor: "old" })
  const rows = page.locator('.task-board-list [data-slot="board-message"]')
  await expect(rows.last().getByRole("group", { name: "Agent to All agents" })).toBeVisible()
  await expect(rows.last().locator('[data-slot="board-route-recipient-icon"] [data-component="icon"]')).toHaveCount(2)
  await expect(
    rows.first().locator('[data-slot="board-route-recipient-icon"] [data-component="agent-avatar"]'),
  ).toHaveCount(1)
  await expect(rows.last().locator("strong")).toHaveText("formatted")
  await expect(rows.last().locator("code")).toHaveText("code")
  expect(icon).not.toBe(await rows.first().locator('[data-component="board-route"] svg').first().innerHTML())
  await expect(page.getByRole("button", { name: "Load earlier messages" })).toHaveCount(0)
  const older = await scene.current(3)
  expect(older).toMatchObject({ before: "old", limit: 50 })
  await result(page, older, {
    ...board,
    revision: 3,
    messages: [{ ...board.messages.at(0)!, id: "first", body: "First message" }],
  })
  await expect(rows).toHaveCount(3)
  await expect(rows.first()).toContainText("First message")
  await expect(rows.last()).toContainText("Newer")
  await page.getByRole("button", { name: "Reset board", exact: true }).click()
  await page
    .getByRole("dialog", { name: "Reset this board?" })
    .getByRole("button", { name: "Reset board", exact: true })
    .click()
  expect(await scene.current(4)).toMatchObject({ type: "resetSessionBoard", revision: 2 })
})

test("reads long messages in a large view and preserves position when history arrives", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 })
  const messages = (start: number, count: number) =>
    Array.from({ length: count }, (_, offset) => {
      const number = start + offset
      return {
        ...board.messages.at(0)!,
        id: `message-${number}`,
        body: `### Update ${number}\n\n${"Detailed verification results with enough context to read comfortably. ".repeat(40)}\n\nVerified with \`serializer\`.`,
      }
    })
  const recent = { ...board, revision: 30, messages: messages(11, 15), cursor: "message-11", hasMore: true }
  const scene = await setup(page, recent)
  await scene.toggle.click()
  await result(page, await scene.current(2), recent)
  const reader = page.getByRole("dialog", { name: "Board", exact: true })
  const viewport = page.locator(".task-board-scroll")
  await expect(reader).toBeVisible()
  const size = await reader.boundingBox()
  expect(size!.width).toBeGreaterThanOrEqual(750)
  expect(size!.height).toBeGreaterThanOrEqual(650)
  await expect(reader.locator("code")).toHaveCount(15)
  await expect
    .poll(() => viewport.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop)))
    .toBeLessThan(2)
  expect(await viewport.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
  await viewport.hover()
  await page.mouse.wheel(0, -100000)
  const older = await scene.current(3)
  expect(older).toMatchObject({ before: "message-11" })
  const anchor = page.getByRole("heading", { name: "Update 11", exact: true })
  await page.mouse.wheel(0, 260)
  await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(200)
  const position = (await anchor.boundingBox())!.y
  await result(page, older, { ...board, revision: 31, messages: messages(1, 10) })
  await expect(reader.locator("code")).toHaveCount(25)
  await expect.poll(async () => Math.abs((await anchor.boundingBox())!.y - position)).toBeLessThan(2)
  await expect(page.getByRole("button", { name: "Load earlier messages" })).toHaveCount(0)
  expect(scene.calls).toHaveLength(3)
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await result(page, await scene.current(4), { ...recent, hasMore: false })
  await expect(reader.locator("code")).toHaveCount(15)
  await expect
    .poll(() => viewport.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop)))
    .toBeLessThan(2)
})

for (const width of [420, 200]) {
  test(`keeps the main board tool renderer consistent at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    await page.goto(
      "/iframe.html?id=composite-webview--agent-messages&viewMode=story&globals=colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern",
    )
    const messages = page.locator('[data-component="board-messages"] [data-slot="board-message"]')
    await expect(messages).toHaveCount(4)
    const routes = messages.locator('[data-component="board-route"]')
    await expect(routes).toHaveCount(2)
    await expect(routes.first()).toHaveCSS("display", width === 200 ? "grid" : "flex")
    await expect(
      routes.first().locator('[data-slot="board-route-recipient-icon"] [data-component="agent-avatar"]'),
    ).toHaveCount(1)
    await expect(routes.last().locator('[data-slot="board-route-recipient-icon"] [data-component="icon"]')).toHaveCount(
      2,
    )
  })
}

test("keeps useful errors private and removes the popup when refresh finds an empty board", async ({ page }) => {
  const scene = await setup(page)
  await scene.toggle.click()
  await result(page, await scene.current(2))
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await result(page, await scene.current(3), board, "Unknown session ses_internal in prj_internal.")
  await expect(page.getByRole("alert")).toHaveText("Could not load or reset the board. Try refreshing it.")
  await expect(page.locator(".task-board")).not.toContainText("ses_internal")
  await expect(page.locator(".task-board")).not.toContainText("prj_internal")
  await expect(page.locator('.task-board-list [data-slot="board-message"]')).toHaveCount(2)
  await page.getByRole("button", { name: "Refresh", exact: true }).click()
  await result(page, await scene.current(4), empty)
  await expect(scene.toggle).toHaveCount(0)
  await expect(page.locator(".task-board")).toHaveCount(0)
})

test("shows a failed reset and requires refresh before another confirmation", async ({ page }) => {
  const scene = await setup(page)
  await scene.toggle.click()
  await result(page, await scene.current(2))
  await page.getByRole("button", { name: "Reset board", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Reset this board?" })
  await dialog.getByRole("button", { name: "Reset board", exact: true }).click()
  const reset = await scene.current(3)
  await result(page, reset, board, "The board changed. Refresh before resetting it.")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("alert")).toHaveText("Could not load or reset the board. Try refreshing it.")
  await dialog.getByRole("button", { name: "Refresh", exact: true }).click()
  const request = await scene.current(4)
  expect(request.type).toBe("requestSessionBoard")
  await result(page, request, { ...board, revision: 3 })
  await page.getByRole("button", { name: "Reset board", exact: true }).click()
  await dialog.getByRole("button", { name: "Reset board", exact: true }).click()
  const confirmed = await scene.current(5)
  expect(confirmed).toMatchObject({ type: "resetSessionBoard", revision: 3 })
  await result(page, confirmed, { ...board, revision: 4 })
  await expect(dialog).toBeHidden()
  await expect(scene.toggle).toBeVisible()
})

test("reset stays confirmed and removes the button instead of opening an empty board", async ({ page }) => {
  const scene = await setup(page)
  await scene.toggle.click()
  const first = await scene.current(2)
  await result(page, first)
  await page.getByRole("button", { name: "Reset board", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Reset this board?" })
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(scene.calls).toHaveLength(2)
  await scene.toggle.click()
  await result(page, await scene.current(3))
  await page.getByRole("button", { name: "Reset board", exact: true }).click()
  await dialog.getByRole("button", { name: "Reset board", exact: true }).click()
  const pending = await scene.current(4)
  expect(pending).toMatchObject({
    type: "resetSessionBoard",
    sessionID: board.ownerSessionID,
    projectId: "project-a",
    revision: 2,
  })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Reset board", exact: true })).toBeDisabled()
  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await expect(dialog).toBeHidden()
  await scene.toggle.click()
  expect(scene.calls).toHaveLength(4)
  await result(page, pending, empty)
  await result(page, first)
  await expect(scene.toggle).toHaveCount(0)
  await expect(page.locator(".task-board")).toHaveCount(0)
})

test("rejects stale scopes and never shows board controls for child or read-only sessions", async ({ page }) => {
  const scene = await setup(page)
  await scene.toggle.click()
  const old = await scene.current(2)
  await change(page, { projectId: "project-b" })
  await expect(scene.toggle).toHaveCount(0)
  const current = await scene.current(3)
  expect(current).toMatchObject({ projectId: "project-b", limit: 1 })
  await result(page, old)
  await result(page, { ...current, projectId: "project-a" })
  await expect(scene.toggle).toHaveCount(0)
  await result(page, current)
  await expect(scene.toggle).toBeVisible()
  await scene.toggle.click()
  await result(page, await scene.current(4))
  await page.getByRole("button", { name: "Reset board", exact: true }).click()
  await change(page, { sessionID: "another-session" })
  await scene.current(5)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await result(page, current)
  await expect(scene.toggle).toHaveCount(0)
  await change(page, { readonly: true })
  await expect(scene.toggle).toHaveCount(0)
  await change(page, { readonly: false, parentID: board.ownerSessionID })
  await expect(scene.toggle).toHaveCount(0)
  expect(scene.calls).toHaveLength(5)
})

test("does not check hidden views and rechecks availability when the view returns", async ({ page }) => {
  const scene = await setup(page, empty)
  await change(page, { active: false })
  await jobs(page, "running")
  expect(scene.calls).toHaveLength(1)
  await change(page, { active: true })
  await result(page, await scene.current(2))
  await expect(scene.toggle).toBeVisible()
})

test("cleans up the reader when it closes repeatedly", async ({ page }) => {
  const scene = await setup(page)
  for (const count of [2, 3, 4]) {
    await scene.toggle.click()
    await result(page, await scene.current(count))
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
  }
  expect(scene.calls).toHaveLength(4)
})
