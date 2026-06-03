import { beforeEach, describe, it, expect } from "bun:test"
import {
  deleteDraftsForSession,
  drafts,
  imageDrafts,
  reviewDrafts,
} from "../../webview-ui/src/utils/draft-store"
import { pendingDraftKey, scopeDraftKey, sessionDraftKey } from "../../webview-ui/src/utils/prompt-drafts"

beforeEach(() => {
  drafts.clear()
  reviewDrafts.clear()
  imageDrafts.clear()
})

describe("deleteDraftsForSession", () => {
  it("clears deleted-session drafts without touching other sessions", () => {
    drafts.set("prompt:default:session:a", "draft a")
    drafts.set("prompt:default:pending:a", "pending a")
    drafts.set("prompt:default:session:b", "draft b")
    reviewDrafts.set("prompt:default:session:a", [])
    imageDrafts.set("prompt:default:session:a", [])

    deleteDraftsForSession("a")

    expect(drafts.has("prompt:default:session:a")).toBe(false)
    expect(drafts.has("prompt:default:pending:a")).toBe(false)
    expect(drafts.get("prompt:default:session:b")).toBe("draft b")
    expect(reviewDrafts.has("prompt:default:session:a")).toBe(false)
    expect(imageDrafts.has("prompt:default:session:a")).toBe(false)
  })
})

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
