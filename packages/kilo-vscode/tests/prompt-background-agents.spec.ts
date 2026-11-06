import { expect, test, type Page } from "@playwright/test"
import type { AgentMap, BackgroundJobInfo, WebviewMessage } from "../webview-ui/src/types/messages"

const globals = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

/** Opens the dock button story behind a fake host that answers job and map requests. */
async function setup(page: Page) {
  const calls: WebviewMessage[] = []
  await page.exposeFunction("record", (message: WebviewMessage) => calls.push(message))
  await page.addInitScript(() => {
    const state = window as unknown as { record: (message: WebviewMessage) => void; requests: number }
    state.requests = 0
    const parent = "story-session-chat-001"
    // Child sessions match the task parts of the story, one per job.
    let jobs: BackgroundJobInfo[] = ["first", "second", "finished", "other"].map((id, index) => ({
      id,
      type: "task",
      title: id,
      status: id === "finished" ? "completed" : "running",
      started_at: 1,
      metadata: {
        parentSessionId: id === "other" ? "other-session" : parent,
        sessionId: `child-${index}`,
        background: true,
      },
    }))
    const map = (): AgentMap => ({
      root: parent,
      nodes: [
        { id: parent, kind: "root", title: "Story session", status: "done", started: 1, finished: 2 },
        ...jobs
          .filter((job) => job.metadata?.parentSessionId === parent)
          .map((job) => ({
            id: String(job.metadata?.sessionId),
            kind: "task" as const,
            parent,
            title: job.title ?? job.id,
            agent: "explore",
            status:
              job.status === "running"
                ? ("running" as const)
                : job.status === "cancelled"
                  ? ("cancelled" as const)
                  : ("done" as const),
            background: true,
            started: 1,
            finished: job.status === "running" ? undefined : 2,
          })),
      ],
    })
    Object.defineProperty(window, "acquireVsCodeApi", {
      value: () => ({
        getState: () => undefined,
        setState: () => {},
        postMessage: (message: WebviewMessage) => {
          if (message.type === "abort") {
            state.record(message)
            jobs = jobs.map((job) =>
              job.metadata?.sessionId === message.sessionID ? { ...job, status: "cancelled" } : job,
            )
          }
          if (message.type === "requestAgentMap") {
            state.requests++
            window.postMessage(
              { type: "agentMapLoaded", sessionID: message.sessionID, requestID: message.requestID, map: map() },
              "*",
            )
          }
          if (message.type !== "requestBackgroundJobs") return
          window.postMessage(
            { type: "backgroundJobsLoaded", sessionID: message.sessionID, requestID: message.requestID, jobs },
            "*",
          )
        },
      }),
    })
  })
  await page.goto(`/iframe.html?id=chat--agent-map-dock-button&viewMode=story&globals=${globals}`)
  const button = page.locator('[data-component="agent-stack"]')
  await expect(button).toBeVisible()
  await active(page, true)
  return { calls, button }
}

/** Reports the view as shown or hidden, as the host does, once the webview has handled it. */
async function active(page: Page, value: boolean) {
  await page.evaluate(
    (shown) =>
      new Promise<void>((done) => {
        // The webview's own listener came first, so it has handled the message when this one runs.
        const seen = (event: MessageEvent) => {
          if (event.data?.type !== "webviewActiveChanged") return
          window.removeEventListener("message", seen)
          done()
        }
        window.addEventListener("message", seen)
        window.postMessage({ type: "webviewActiveChanged", active: shown }, "*")
      }),
    value,
  )
}

const requests = (page: Page) => page.evaluate(() => (window as unknown as { requests: number }).requests)

test("Agent map button counts this session's running agents and stops them from the map", async ({ page }) => {
  const scene = await setup(page)
  // Two of this session's agents run. The finished one and the other session's agent do not count.
  await expect(scene.button.locator('[data-slot="agent-stack-count"]')).toHaveText("2")
  await scene.button.click()
  const map = page.locator(".agent-map")
  await expect(map.locator('[data-slot="agent-map-node"][data-status="running"]')).toHaveCount(2)
  await expect(map.locator('[data-slot="agent-map-node"][data-id="child-2"]')).toHaveAttribute("data-status", "done")
  await map.getByRole("button", { name: "Stop all (2)", exact: true }).click()
  await expect
    .poll(() => scene.calls)
    .toEqual([0, 1].map((index) => ({ type: "abort", sessionID: `child-${index}`, scope: "tree" })))
  // Stopped agents stay on the map with their final status.
  await expect(map.locator('[data-slot="agent-map-node"][data-status="cancelled"]')).toHaveCount(2)
  await expect(scene.button.locator('[data-slot="agent-stack-count"]')).toHaveCount(0)
})

test("Agent map asks for no map while its view is hidden, and for one as soon as it returns", async ({ page }) => {
  const scene = await setup(page)
  // The poll starts with the dialog, so from here on it fires only when the test moves the clock.
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") })
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"))
  await scene.button.click()
  await expect(page.locator('.agent-map [data-slot="agent-map-node"]')).toHaveCount(4)
  const start = await requests(page)
  // The map polls every two seconds while it shows.
  await page.clock.runFor(2_000)
  expect(await requests(page)).toBe(start + 1)
  await active(page, false)
  await page.clock.runFor(10_000)
  expect(await requests(page)).toBe(start + 1)
  // The clock stands still, so only the view showing again can ask.
  await active(page, true)
  expect(await requests(page)).toBe(start + 2)
})
