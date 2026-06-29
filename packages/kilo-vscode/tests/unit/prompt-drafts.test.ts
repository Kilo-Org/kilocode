import { describe, it, expect } from "bun:test"
import {
  createdDraftKey,
  movePromptDraft,
  pendingDraftKey,
  scopeDraftKey,
  sessionDraftKey,
} from "../../webview-ui/src/utils/prompt-drafts"

describe("sessionDraftKey", () => {
  it("prefixes session ids", () => {
    expect(sessionDraftKey("abc")).toBe("session:abc")
  })

  it("returns undefined when no id is present", () => {
    expect(sessionDraftKey()).toBeUndefined()
  })
})

describe("pendingDraftKey", () => {
  it("prefixes pending ids", () => {
    expect(pendingDraftKey("pending:1")).toBe("pending:1")
  })

  it("returns undefined when no id is present", () => {
    expect(pendingDraftKey()).toBeUndefined()
  })
})

describe("scopeDraftKey", () => {
  it("scopes raw keys to a prompt box", () => {
    expect(scopeDraftKey("prompt:1", "session:abc")).toBe("prompt:1:session:abc")
  })

  it("falls back to an empty key when raw key is missing", () => {
    expect(scopeDraftKey("prompt:1")).toBe("prompt:1:empty")
  })
})

describe("createdDraftKey", () => {
  it("uses the pending key when a draft id exists", () => {
    expect(createdDraftKey("draft-1", true)).toBe("pending:draft-1")
  })

  it("uses the new-chat key for sandbox-triggered session creation", () => {
    expect(createdDraftKey(undefined, true)).toBe("new")
  })

  it("ignores unrelated session creation without a draft id", () => {
    expect(createdDraftKey()).toBeUndefined()
  })
})

describe("movePromptDraft", () => {
  it("moves text, review comments, and images to the created session", () => {
    const source = scopeDraftKey("prompt:default", createdDraftKey(undefined, true))
    const target = scopeDraftKey("prompt:default", sessionDraftKey("session-1"))
    const comment = { id: "comment-1", body: "Keep this review note" }
    const image = { id: "image-1", dataUrl: "data:image/png;base64,abc" }
    const text = new Map([[source, "Keep this prompt"]])
    const comments = new Map([[source, [comment]]])
    const images = new Map([[source, [image]]])
    const scrolls = new Map([[source, 128]])

    expect(movePromptDraft({ text, comments, images, scrolls }, source, target)).toEqual({
      text: "Keep this prompt",
      comments: [comment],
      images: [image],
      scroll: 128,
    })
    expect(text.get(target)).toBe("Keep this prompt")
    expect(comments.get(target)).toEqual([comment])
    expect(images.get(target)).toEqual([image])
    expect(scrolls.get(target)).toBe(128)
    expect(text.has(source)).toBe(false)
    expect(comments.has(source)).toBe(false)
    expect(images.has(source)).toBe(false)
    expect(scrolls.has(source)).toBe(false)
  })
})
