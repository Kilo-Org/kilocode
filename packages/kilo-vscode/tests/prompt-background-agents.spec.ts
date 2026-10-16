import { expect, test } from "@playwright/test"
import type { BackgroundJobInfo, WebviewMessage } from "../webview-ui/src/types/messages"

const globals = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

test("Agent panel stops only this session's running agents and clears finished ones", async ({ page }) => {
  const calls: WebviewMessage[] = []
  await page.exposeFunction("record", (message: WebviewMessage) => calls.push(message))
  await page.addInitScript(() => {
    const record = (window as unknown as { record: (message: WebviewMessage) => void }).record
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
    Object.defineProperty(window, "acquireVsCodeApi", {
      value: () => ({
        getState: () => undefined,
        setState: () => {},
        postMessage: (message: WebviewMessage) => {
          if (message.type === "abort") {
            record(message)
            jobs = jobs.map((job) =>
              job.metadata?.sessionId === message.sessionID ? { ...job, status: "cancelled" } : job,
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
  await page.goto(`/iframe.html?id=chat--background-agent-panel&viewMode=story&globals=${globals}`)
  await page.locator('[data-component="agent-stack"]').click()
  const panel = page.locator('[data-slot="agent-panel"]')
  await expect(panel.locator('[data-slot="agent-panel-row"][data-status="running"]')).toHaveCount(2)
  await expect(panel.locator('[data-slot="agent-panel-row"][data-status="completed"]')).toHaveCount(1)
  await expect(panel.getByRole("button", { name: "Open background agent: first" })).toBeVisible()
  // The finished agent never ran while polled, but it belongs to this run.
  await expect(panel.getByRole("button", { name: "Open background agent: finished" })).toBeVisible()
  await panel.getByRole("button", { name: "Stop all (2)", exact: true }).click()
  await expect
    .poll(() => calls)
    .toEqual([0, 1].map((index) => ({ type: "abort", sessionID: `child-${index}`, scope: "tree" })))
  // Stopped agents stay in the run with their final status.
  await expect(panel.locator('[data-slot="agent-panel-row"][data-status="cancelled"]')).toHaveCount(2)
  await panel.getByRole("button", { name: "Clear finished" }).click()
  await expect(panel).toHaveCount(0)
})
