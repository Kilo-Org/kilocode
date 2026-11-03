import { afterEach, describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import {
  APPEND_REVIEW_COMMENTS,
  type AppendReviewCommentsDetail,
  sendReviewComments,
  takeReviewCommentsForPrompt,
  takeReviewCommentsForTerminal,
} from "../webview-ui/diff-viewer/review-annotations"
import { sendPRComment, sendThreads } from "../webview-ui/agent-manager/pr/pr-actions"
import { commentState } from "../webview-ui/agent-manager/pr/pr-comment-state"
import { formatReviewCommentsMarkdown, type ReviewCommentData } from "../src/shared/review-comments"
import type { PRComment } from "../webview-ui/agent-manager/pr/pr-types"

const original = {
  document: globalThis.document,
  window: globalThis.window,
  event: globalThis.CustomEvent,
}

afterEach(() => {
  globalThis.document = original.document
  globalThis.window = original.window
  globalThis.CustomEvent = original.event
})

function setup() {
  const view = new Window()
  globalThis.document = view.document as unknown as typeof globalThis.document
  globalThis.window = view as unknown as typeof globalThis.window
  globalThis.CustomEvent = view.CustomEvent as unknown as typeof globalThis.CustomEvent
  return view
}

function local(id = "c-1"): ReviewCommentData {
  return { id, file: "src/file.ts", side: "additions", line: 2, comment: "Use the helper", selectedText: "old" }
}

function thread(id: string): PRComment {
  return { id: `c-${id}`, threadId: id, author: "a", body: id, resolved: false, outdated: false }
}

function promptConsumer(appended: string[]) {
  return (event: Event) => {
    const text = takeReviewCommentsForPrompt((event as CustomEvent<AppendReviewCommentsDetail>).detail)
    if (text !== undefined) appended.push(text)
  }
}

function terminalConsumer(terminalId: string, pasted: string[]) {
  return (event: Event) => {
    const text = takeReviewCommentsForTerminal(
      (event as CustomEvent<AppendReviewCommentsDetail>).detail,
      terminalId,
    )
    if (text !== undefined) pasted.push(text)
  }
}

describe("review comment delivery", () => {
  it("reports a batch as unhandled when no consumer takes it", () => {
    const view = setup()
    expect(sendReviewComments([local()])).toBe(false)
    expect(sendReviewComments([local()], "terminal-1")).toBe(false)
    view.close()
  })

  it("appends an untargeted batch to the prompt exactly once", () => {
    const view = setup()
    const appended: string[] = []
    window.addEventListener(APPEND_REVIEW_COMMENTS, promptConsumer(appended))

    expect(sendReviewComments([local()])).toBe(true)
    expect(appended).toEqual([formatReviewCommentsMarkdown([local()])])

    expect(sendReviewComments([local()], "terminal-1")).toBe(false)
    expect(appended).toHaveLength(1)
    view.close()
  })

  it("pastes a targeted batch only into the matching terminal", () => {
    const view = setup()
    const appended: string[] = []
    const pasted: string[] = []
    window.addEventListener(APPEND_REVIEW_COMMENTS, promptConsumer(appended))
    window.addEventListener(APPEND_REVIEW_COMMENTS, terminalConsumer("terminal-1", pasted))

    expect(sendReviewComments([local()], "terminal-2")).toBe(false)
    expect(pasted).toEqual([])

    expect(sendReviewComments([local()], "terminal-1")).toBe(true)
    expect(pasted).toEqual([`${formatReviewCommentsMarkdown([local()])}\n`])
    expect(appended).toEqual([])
    view.close()
  })

  it("marks a remote comment sent only when a consumer takes it", () => {
    const view = setup()
    const comment = thread("remote")
    let marked = 0
    const markSent = () => {
      marked += 1
    }

    expect(sendPRComment(comment, "terminal-missing", markSent)).toBe(false)
    expect(marked).toBe(0)

    window.addEventListener(APPEND_REVIEW_COMMENTS, promptConsumer([]))
    expect(sendPRComment(comment, undefined, markSent)).toBe(true)
    expect(marked).toBe(1)
    view.close()
  })

  it("keeps PR comments unsent until a consumer takes the batch", () => {
    const view = setup()
    const worktree = "review-send-unhandled"
    const comments = [thread("open")]

    sendThreads(worktree, comments, ["open"], commentState(worktree), "terminal-missing")
    expect(commentState(worktree).sent).toEqual({})

    sendThreads(worktree, comments, ["open"], commentState(worktree))
    expect(commentState(worktree).sent).toEqual({})

    window.addEventListener(APPEND_REVIEW_COMMENTS, promptConsumer([]))
    sendThreads(worktree, comments, ["open"], commentState(worktree))
    expect(commentState(worktree).sent).toEqual({ open: true })
    view.close()
  })
})
