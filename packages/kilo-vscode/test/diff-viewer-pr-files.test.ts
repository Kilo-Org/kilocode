import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { createPRFiles } from "../webview-ui/diff-viewer/pr-files"
import type { PRTarget } from "../src/shared/pr-comment-actions"

const url = "https://github.com/owner/repo/pull/7"

let events: EventTarget
const original = Object.getOwnPropertyDescriptor(globalThis, "window")

beforeEach(() => {
  events = new EventTarget()
  Object.defineProperty(globalThis, "window", { value: events, configurable: true, writable: true })
})

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "window", original)
  else delete (globalThis as { window?: unknown }).window
})

const target = (head: string): PRTarget => ({
  projectId: "pr",
  worktreeId: "diff",
  prNumber: 7,
  prUrl: url,
  baseRefOid: "base",
  headRefOid: head,
})

function setup() {
  const posted: Record<string, unknown>[] = []
  const files = createRoot(() =>
    createPRFiles({
      post: (message) => posted.push(message as unknown as Record<string, unknown>),
      failed: () => "load failed",
    }),
  )
  const settle = (message: Record<string, unknown>, result: Record<string, unknown>) =>
    events.dispatchEvent(
      new MessageEvent("message", { data: { ...message, type: "agentManager.loadPRFilesResult", ...result } }),
    )
  return { files, posted, settle }
}

const snapshot = (id: string) => ({ id, head: id, files: [] })

describe("createPRFiles", () => {
  it("keeps the previous snapshot while a ref-only refresh loads", () => {
    const h = setup()
    h.files.request(target("a"))
    h.settle(h.posted[0]!, { success: true, snapshot: snapshot("a") })
    h.files.request(target("b"))

    expect(h.files.loading()).toBe(true)
    expect(h.files.snapshot()?.id).toBe("a")
  })

  it("retries the same refs after a failed refresh", () => {
    const h = setup()
    h.files.request(target("a"))
    h.settle(h.posted[0]!, { success: true, snapshot: snapshot("a") })
    h.files.request(target("b"))
    h.settle(h.posted[1]!, { success: false, error: "gh failed" })

    expect(h.files.error()).toBe("gh failed")
    expect(h.files.snapshot()?.id).toBe("a")

    h.files.request(target("b"))
    expect(h.posted).toHaveLength(3)
    h.settle(h.posted[2]!, { success: true, snapshot: snapshot("b") })
    expect(h.files.snapshot()?.id).toBe("b")
    expect(h.files.error()).toBeUndefined()
  })

  it("does not ask again while the same refs load or after they loaded", () => {
    const h = setup()
    h.files.request(target("a"))
    h.files.request(target("a"))
    h.settle(h.posted[0]!, { success: true, snapshot: snapshot("a") })
    h.files.request(target("a"))

    expect(h.posted).toHaveLength(1)
  })

  it("clears the snapshot for another PR", () => {
    const h = setup()
    h.files.request(target("a"))
    h.settle(h.posted[0]!, { success: true, snapshot: snapshot("a") })
    h.files.request({ ...target("a"), prNumber: 8, prUrl: `${url}8` })

    expect(h.files.snapshot()).toBeUndefined()
  })
})
