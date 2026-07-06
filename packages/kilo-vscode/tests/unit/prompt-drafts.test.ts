import { beforeEach, describe, it, expect } from "bun:test"
import { createEffect, createRoot, createSignal, on } from "solid-js"
import { deleteDraftsForSession, drafts, imageDrafts, reviewDrafts } from "../../webview-ui/src/utils/draft-store"
import {
  createdDraftKey,
  movePromptDraft,
  pendingDraftKey,
  scopeDraftKey,
  sessionDraftKey,
} from "../../webview-ui/src/utils/prompt-drafts"

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

  it("is a no-op when given an empty id", () => {
    drafts.set("prompt:default:session:a", "draft a")
    deleteDraftsForSession("")
    expect(drafts.get("prompt:default:session:a")).toBe("draft a")
  })

  it("clears drafts that PromptInput's draftKey effect recreates after the batch", () => {
    // Production race that motivated the post-batch deleteDraftsForSession call:
    //   1. handleSessionDeleted batches setCurrentSessionID(undefined) +
    //      setDraftSessionID(undefined). PromptInput's draftKey memo transitions from
    //      ":session:<id>" to the "new" bucket.
    //   2. PromptInput's createEffect(on(draftKey, ...)) runs after the batch and calls
    //      saveDraft(prev, currentText, currentImages), writing the live prompt and any
    //      attached image data URLs back into the just-cleared ":session:<id>" key.
    //   3. deleteDraftsForSession runs after the effect and clears the re-added entry.
    //
    // The test wires the same reactive plumbing — real Solid createSignal/createEffect/on
    // against the same scopeDraftKey/sessionDraftKey/pendingDraftKey helpers PromptInput
    // uses — so a regression that moves the cleanup back inside the batch (or drops it
    // entirely) leaks the recreated draft and the final assertion fails.
    const img = {
      id: "i1",
      filename: "x.png",
      mime: "image/png",
      dataUrl: "data:image/png;base64,AAAA",
    }
    const draftKey = "prompt:default:session:race"

    createRoot((dispose) => {
      // Live prompt state, the way PromptInput tracks it.
      const [text, setText] = createSignal("draft a")
      const [images] = createSignal([img])
      const [currentSessionID, setCurrentSessionID] = createSignal<string | undefined>("race")
      const [draftSessionID, setDraftSessionID] = createSignal<string | undefined>("race")

      const boxKey = "prompt:default"
      const rawKey = () =>
        sessionDraftKey(currentSessionID()) ?? pendingDraftKey(draftSessionID() ?? undefined) ?? "new"
      const key = () => scopeDraftKey(boxKey, rawKey())

      // Pre-deletion: the user has unsent text and an attached image for this session.
      drafts.set(draftKey, text())
      imageDrafts.set(draftKey, images())

      // Mirror the saveDraft behavior PromptInput's effect runs when draftKey transitions.
      createEffect(
        on(key, (k, prev) => {
          if (prev !== undefined && prev !== k) {
            drafts.set(prev, text())
            imageDrafts.set(prev, images())
          }
        }),
      )

      // Production batch: clear the ids so draftKey transitions off ":session:<id>".
      setCurrentSessionID(undefined)
      setDraftSessionID(undefined)
      // Solid has now run the effect; the recreate happened. Sanity-check before cleanup.
      expect(drafts.has(draftKey)).toBe(true)
      expect(imageDrafts.has(draftKey)).toBe(true)

      // The post-batch cleanup. A single in-batch call (run before the effect) would
      // have been wiped by the recreate above and not catch this — the post-batch
      // call is what actually frees the entry.
      deleteDraftsForSession("race")
      dispose()
    })

    expect(drafts.has(draftKey)).toBe(false)
    expect(imageDrafts.has(draftKey)).toBe(false)
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
