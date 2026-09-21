import { expect, test } from "@playwright/test"
import type { BackgroundJobInfo, WebviewMessage } from "../webview-ui/src/types/messages"

const globals = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

test("Stop all only cancels this session's running background agents", async ({ page }) => {
  const calls: WebviewMessage[] = []
  await page.exposeFunction("record", (message: WebviewMessage) => calls.push(message))
  await page.addInitScript(() => {
    const record = (window as unknown as { record: (message: WebviewMessage) => void }).record
    const parent = "story-session-chat-001"
    let jobs: BackgroundJobInfo[] = ["first", "second", "finished", "other"].map((id) => ({
      id,
      type: "task",
      title: id,
      status: id === "finished" ? "completed" : "running",
      started_at: 1,
      metadata: {
        parentSessionId: id === "other" ? "other-session" : parent,
        sessionId: `child-${id}`,
        background: true,
      },
    }))
    Object.defineProperty(window, "acquireVsCodeApi", {
      value: () => ({
        getState: () => undefined,
        setState: () => {},
        postMessage: (message: WebviewMessage) => {
          if (message.type === "abort" || message.type === "cancelBackgroundJob") {
            record(message)
          }
          if (message.type !== "requestBackgroundJobs" && message.type !== "cancelBackgroundJob") return
          if (message.type === "cancelBackgroundJob") {
            jobs = jobs.map((job) => (job.id === message.jobID ? { ...job, status: "cancelled" } : job))
          }
          window.postMessage(
            { type: "backgroundJobsLoaded", sessionID: message.sessionID, requestID: message.requestID, jobs },
            "*",
          )
        },
      }),
    })
  })
  await page.goto(`/iframe.html?id=chat--task-header-background-agents-420&viewMode=story&globals=${globals}`)
  const bar = page.locator('[data-component="task-header-agents"]')
  const stop = bar.getByRole("button", { name: "Stop all (2)", exact: true })
  await expect(stop).toBeVisible()
  await expect(bar.locator('[data-slot="task-header-todos-list"]')).toHaveCount(0)
  await stop.click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect
    .poll(() => calls)
    .toEqual(
      ["first", "second"].map((jobID) => ({
        type: "cancelBackgroundJob",
        sessionID: "story-session-chat-001",
        jobID,
        requestID: expect.any(String),
      })),
    )
  await expect(bar.getByRole("button", { name: /^Stop all/ })).toHaveCount(0)
  await bar.locator('[data-slot="task-header-agents-toggle"]').click()
  await expect(bar.locator('[data-slot="task-header-agent"][data-status="cancelled"]')).toHaveCount(2)
  await expect(bar.locator('[data-slot="task-header-agent"][data-status="completed"]')).toHaveCount(1)
})
