import { describe, expect, it } from "bun:test"
import type { PRCommentRequest, PRCommentResult } from "../../src/shared/pr-comment-actions"
import { reviewRequest } from "../../webview-ui/agent-manager/pr/pr-review-request"

describe("reviewRequest", () => {
  it("settles a dropped result as a failure and removes its listener", async () => {
    const events = new EventTarget()
    let active = 0
    const target = {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (type === "message") active++
        events.addEventListener(type, listener)
      },
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (type === "message") active--
        events.removeEventListener(type, listener)
      },
      dispatchEvent: (event: Event) => events.dispatchEvent(event),
    }
    const previous = globalThis.window
    globalThis.window = target as typeof globalThis.window

    try {
      const message: PRCommentRequest = {
        type: "agentManager.replyComment",
        projectId: "project",
        worktreeId: "worktree",
        threadId: "thread",
        body: "draft",
        requestId: "request",
      }
      const sent: unknown[] = []
      const results: PRCommentResult[] = []
      const done = Promise.withResolvers<PRCommentResult>()
      const dispose = reviewRequest(
        message,
        (value: never) => sent.push(value),
        (result) => {
          results.push(result)
          done.resolve(result)
        },
        5,
      )

      expect(sent).toEqual([message])
      expect(active).toBe(1)
      target.dispatchEvent(
        new MessageEvent("message", {
          data: { ...message, type: "agentManager.replyCommentResult", requestId: "other", success: true },
        }),
      )
      expect(results).toHaveLength(0)

      await expect(done.promise).resolves.toMatchObject({
        type: "agentManager.replyCommentResult",
        projectId: "project",
        worktreeId: "worktree",
        threadId: "thread",
        requestId: "request",
        success: false,
        error: "Request timed out",
      })
      expect(active).toBe(0)
      target.dispatchEvent(
        new MessageEvent("message", { data: { ...message, type: "agentManager.replyCommentResult", success: true } }),
      )
      expect(results).toHaveLength(1)

      dispose()
      expect(active).toBe(0)
    } finally {
      globalThis.window = previous
    }
  })
})
