import { afterEach, describe, expect, it } from "bun:test"
import {
  beginPromptMentionDrop,
  endPromptMentionDrop,
  insideRect,
  promptMentionDragging,
  promptMentionOver,
  registerPromptMentionDrop,
  type PromptMentionDrop,
} from "../../webview-ui/src/utils/prompt-mention-drop"

const hadDoc = "document" in globalThis
const originalDoc = hadDoc ? globalThis.document : undefined
const listeners = new Set<(event: PointerEvent) => void>()

function mockDocument() {
  listeners.clear()
  ;(globalThis as Record<string, unknown>).document = {
    addEventListener: (type: string, handler: (event: PointerEvent) => void) => {
      if (type === "pointermove") listeners.add(handler)
    },
    removeEventListener: (type: string, handler: (event: PointerEvent) => void) => {
      if (type === "pointermove") listeners.delete(handler)
    },
  }
}

function restoreDocument() {
  if (hadDoc) (globalThis as Record<string, unknown>).document = originalDoc
  else delete (globalThis as Record<string, unknown>).document
}

function move(x: number, y: number) {
  for (const handler of listeners) handler({ clientX: x, clientY: y } as PointerEvent)
}

function target() {
  return {
    isConnected: true,
    getBoundingClientRect: () => ({ left: 100, top: 100, right: 300, bottom: 200 }),
  } as unknown as HTMLElement
}

const drop: PromptMentionDrop = {
  kind: "session",
  session: { id: "s1", title: "Chat", updated: 1 },
}

afterEach(() => {
  registerPromptMentionDrop(undefined, undefined)
  endPromptMentionDrop()
  restoreDocument()
})

describe("insideRect", () => {
  it("includes the edges and excludes outside points", () => {
    const rect = { left: 10, top: 20, right: 30, bottom: 40 }
    expect(insideRect(rect, 10, 20)).toBe(true)
    expect(insideRect(rect, 30, 40)).toBe(true)
    expect(insideRect(rect, 9, 20)).toBe(false)
    expect(insideRect(rect, 30, 41)).toBe(false)
  })
})

describe("prompt mention drop", () => {
  it("inserts only when the last pointer position is inside the target", () => {
    mockDocument()
    const inserted: PromptMentionDrop[] = []
    registerPromptMentionDrop(target(), (value) => {
      inserted.push(value)
      return true
    })

    beginPromptMentionDrop(drop)
    move(200, 150)
    expect(endPromptMentionDrop()).toBe(true)

    expect(inserted).toEqual([drop])
  })

  it("does not insert when the pointer is outside the target", () => {
    mockDocument()
    const inserted: PromptMentionDrop[] = []
    registerPromptMentionDrop(target(), (value) => {
      inserted.push(value)
      return true
    })

    beginPromptMentionDrop(drop)
    move(500, 500)
    expect(endPromptMentionDrop()).toBe(false)

    expect(inserted).toEqual([])
  })

  it("does nothing when no target is registered", () => {
    mockDocument()
    beginPromptMentionDrop(drop)
    expect(listeners.size).toBe(0)
    expect(endPromptMentionDrop()).toBe(false)
  })

  it("tears down an active drag when the prompt unmounts", () => {
    mockDocument()
    registerPromptMentionDrop(target(), () => true)
    beginPromptMentionDrop(drop)
    expect(listeners.size).toBe(1)
    expect(promptMentionDragging()).toBe(true)

    registerPromptMentionDrop(undefined, undefined)

    expect(listeners.size).toBe(0)
    expect(promptMentionDragging()).toBe(false)
    expect(promptMentionOver()).toBe(false)
    expect(endPromptMentionDrop()).toBe(false)
  })
})
