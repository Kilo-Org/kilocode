import { beforeEach, describe, expect, it } from "bun:test"
import {
  beginPendingSend,
  clearSessionDraftDiscarded,
  deleteDraftsForSession,
  discardPendingDraft,
  drafts,
  imageDrafts,
  isPendingDraftDiscarded,
  isSessionDraftDiscarded,
  isPendingSend,
  promotePendingDraftDiscard,
  reviewDrafts,
  savePromptDraft,
  scrollDrafts,
  finishPendingSend,
} from "../../webview-ui/src/utils/draft-store"

const stores = [drafts, reviewDrafts, imageDrafts, scrollDrafts]

beforeEach(() => stores.forEach((store) => store.clear()))

describe("prompt draft storage", () => {
  it("stores and clears all prompt artifacts together", () => {
    savePromptDraft(
      "prompt:default:pending:sidebar-pending:1",
      "draft",
      [{ id: "review", file: "a.ts", side: "additions", line: 1, comment: "comment", selectedText: "line" }],
      [{ id: "image", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,a" }],
      42,
    )

    expect(drafts.size).toBe(1)
    expect(reviewDrafts.size).toBe(1)
    expect(imageDrafts.size).toBe(1)
    expect(scrollDrafts.size).toBe(1)

    discardPendingDraft("sidebar-pending:1")
    expect(stores.every((store) => store.size === 0)).toBe(true)
    expect(isPendingDraftDiscarded("sidebar-pending:1")).toBe(true)
  })

  it("normalizes Agent Manager pending ids", () => {
    savePromptDraft("agent-manager:local:pending:1", "draft", [], [], 3)
    discardPendingDraft("pending:1")
    expect(drafts.size).toBe(0)
    expect(scrollDrafts.size).toBe(0)
  })

  it("promotes an in-flight discard marker to the created session", () => {
    discardPendingDraft("pending:promotion")
    expect(promotePendingDraftDiscard("pending:promotion", "s1")).toBe(true)
    expect(isPendingDraftDiscarded("pending:promotion")).toBe(false)
    expect(isSessionDraftDiscarded("s1")).toBe(true)
    clearSessionDraftDiscarded("s1")
  })

  it("tracks pending work before backend submission starts", () => {
    beginPendingSend("pending:attachment")
    expect(isPendingSend("pending:attachment")).toBe(true)
    finishPendingSend("pending:attachment")
    expect(isPendingSend("pending:attachment")).toBe(false)
  })

  it("deletes session and pre-promotion pending keys", () => {
    savePromptDraft("prompt:default:session:s1", "session", [], [], 1)
    savePromptDraft("prompt:default:pending:s1", "pending", [], [], 2)
    deleteDraftsForSession("s1")
    expect(drafts.size).toBe(0)
    expect(scrollDrafts.size).toBe(0)
  })
})
