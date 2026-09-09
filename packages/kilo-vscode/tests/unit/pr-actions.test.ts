import { describe, expect, it } from "bun:test"
import { actionableConversation, unsentThreads } from "../../webview-ui/agent-manager/pr/pr-actions"
import { commentState } from "../../webview-ui/agent-manager/pr/pr-comment-state"
import type { PRComment, PRConversationComment } from "../../webview-ui/agent-manager/pr/pr-types"

const thread = (id: string, resolved = false): PRComment => ({
  id: `c-${id}`,
  threadId: id,
  author: "a",
  body: id,
  resolved,
  outdated: false,
})

const talk = (id: string, isBot = false): PRConversationComment => ({ id, author: "a", body: id, isBot })

describe("pr-actions", () => {
  it("lists unresolved threads that are not sent, honoring the optimistic resolve", () => {
    const blank = commentState("none")
    const list = [thread("open"), thread("done", true), thread("sent"), thread("resolving")]
    expect(unsentThreads(list, blank)).toEqual(["open", "sent", "resolving"])
    const state = { ...blank, sent: { sent: true }, pending: { resolving: true, done: false } }
    expect(unsentThreads(list, state)).toEqual(["open", "done"])
  })

  it("lists human conversation comments that are not sent or dismissed", () => {
    const blank = commentState("none")
    const list = [talk("human"), talk("bot", true), talk("sent"), talk("gone")]
    expect(actionableConversation(list, blank)).toEqual(["human", "sent", "gone"])
    const state = { ...blank, sent: { sent: true }, dismissed: { gone: true } }
    expect(actionableConversation(list, state)).toEqual(["human"])
  })
})
