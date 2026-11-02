import { expect, test } from "@playwright/test"
import type { AgentMap, BackgroundJobInfo, WebviewMessage } from "../webview-ui/src/types/messages"

const globals = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

test("Agent map button counts this session's running agents and stops them from the map", async ({ page }) => {
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
            record(message)
            jobs = jobs.map((job) =>
              job.metadata?.sessionId === message.sessionID ? { ...job, status: "cancelled" } : job,
            )
          }
          if (message.type === "requestAgentMap") {
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
  // Two of this session's agents run. The finished one and the other session's agent do not count.
  await expect(button.locator('[data-slot="agent-stack-count"]')).toHaveText("2")
  await button.click()
  const map = page.locator(".agent-map")
  await expect(map.locator('[data-slot="agent-map-node"][data-status="running"]')).toHaveCount(2)
  await expect(map.locator('[data-slot="agent-map-node"][data-id="child-2"]')).toHaveAttribute("data-status", "done")
  await map.getByRole("button", { name: "Stop all (2)", exact: true }).click()
  await expect
    .poll(() => calls)
    .toEqual([0, 1].map((index) => ({ type: "abort", sessionID: `child-${index}`, scope: "tree" })))
  // Stopped agents stay on the map with their final status.
  await expect(map.locator('[data-slot="agent-map-node"][data-status="cancelled"]')).toHaveCount(2)
  await expect(button.locator('[data-slot="agent-stack-count"]')).toHaveCount(0)
})
