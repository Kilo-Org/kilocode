import { describe, expect, it } from "bun:test"
import {
  commentKey,
  commentScroll,
  commentState,
  patchCommentState,
  setCommentScroll,
} from "../../webview-ui/agent-manager/pr/pr-comment-state"

describe("PR panel state ownership", () => {
  it("keeps thread state and scroll positions separate for matching worktree IDs in different projects", () => {
    const first = commentKey("first", "worktree")
    const second = commentKey("second", "worktree")
    const other = commentKey("first", "other")
    patchCommentState(first, () => ({ expanded: { thread: true }, sent: { thread: true } }))
    setCommentScroll(first, 320, { id: "thread", offset: 12 })
    for (const key of [second, other, commentKey(undefined, "worktree")]) {
      expect(commentState(key).expanded).toEqual({})
      expect(commentState(key).sent).toEqual({})
      expect(commentScroll(key)).toBeUndefined()
    }
    patchCommentState(second, () => ({ expanded: { thread: false } }))
    setCommentScroll(second, 40)
    expect(commentState(first).expanded).toEqual({ thread: true })
    expect(commentScroll(first)).toEqual({ scroll: 320, anchor: { id: "thread", offset: 12 } })
    expect(commentState(second).expanded).toEqual({ thread: false })
    expect(commentScroll(second)).toEqual({ scroll: 40 })
  })
})
