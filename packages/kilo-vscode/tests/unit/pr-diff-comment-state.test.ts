import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { createPRDiffCommentState } from "../../webview-ui/agent-manager/pr/diff-comment-state"
import type { ExtensionMessage } from "../../webview-ui/src/types/messages"

const url = "https://github.com/owner/repo/pull/7"

let events: EventTarget
const original = Object.getOwnPropertyDescriptor(globalThis, "window")

beforeEach(() => {
  events = new EventTarget()
  Object.defineProperty(globalThis, "window", { value: events, configurable: true, writable: true })
})

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "window", original)
  else Reflect.deleteProperty(globalThis, "window")
})

function setup() {
  const posted: Record<string, unknown>[] = []
  const handlers = new Set<(message: ExtensionMessage) => void>()
  const statuses = { wt: { number: 7, url, baseRefOid: "b", headRefOid: "a" } }
  const receive = (message: ExtensionMessage) => handlers.forEach((handler) => handler(message))
  const settle = (message: Record<string, unknown>, snapshotId: string) =>
    events.dispatchEvent(
      new MessageEvent("message", {
        data: {
          ...message,
          type: "agentManager.loadPRFilesResult",
          success: true,
          snapshot: { id: snapshotId, head: "a", files: [] },
        },
      }),
    )
  const state = createRoot((dispose) => {
    const value = createPRDiffCommentState({
      post: (message) => posted.push(message as unknown as Record<string, unknown>),
      onMessage: (handler) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
      project: () => "project",
      statuses: () => statuses,
    })
    value.load("wt")
    settle(posted[0]!, "S1")
    return { value, dispose }
  })
  const comment = (over: Record<string, unknown> = {}) => ({
    type: "agentManager.createReviewCommentResult",
    projectId: "project",
    worktreeId: "wt",
    prNumber: 7,
    prUrl: url,
    requestId: "r1",
    success: false,
    error: "Review snapshot expired or belongs to another pull request. Reload the review.",
    ...over,
  })
  return { posted, receive, settle, state, comment }
}

describe("PR diff comment state", () => {
  it("reloads the snapshot when the host rejects a comment for a snapshot it no longer holds", () => {
    const { posted, receive, settle, state, comment } = setup()
    expect(posted).toHaveLength(1)
    expect(state.value.snapshot("wt")?.id).toBe("S1")

    receive(comment() as ExtensionMessage)

    // The stale snapshot is dropped and a fresh one requested.
    expect(posted).toHaveLength(2)
    expect(posted[1]?.type).toBe("agentManager.loadPRFiles")
    expect(state.value.snapshot("wt")).toBeUndefined()
    settle(posted[1]!, "S2")
    expect(state.value.snapshot("wt")?.id).toBe("S2")

    state.dispose()
  })

  it("keeps the cached snapshot when a comment succeeds or belongs elsewhere", () => {
    const { posted, receive, state, comment } = setup()

    receive(comment({ success: true, error: undefined }) as ExtensionMessage)
    receive(comment({ worktreeId: "other" }) as ExtensionMessage)
    receive(comment({ projectId: "other" }) as ExtensionMessage)

    expect(posted).toHaveLength(1)
    expect(state.value.snapshot("wt")?.id).toBe("S1")

    state.dispose()
  })
})
