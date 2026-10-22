import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { promptOffsetWidth } from "../../src/prompt/display"
import { expandPastedPlaceholder, expandTrackedPastedText } from "../../src/prompt/part"

const CONTENT = "line1\nline2\nline3\nline4\nline5\nline6"
const PLACEHOLDER = "[Pasted ~6 lines]"
const OTHER = "other1\nother2\nother3\nother4\nother5"
const OTHER_PLACEHOLDER = "[Pasted ~5 lines]"

async function createPrompt() {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const input = new TextareaRenderable(setup.renderer as any, { id: "prompt" })
  const typeId = input.extmarks.registerType("prompt-part")
  const parts: unknown[] = []
  const map = new Map<number, number>()

  // mirrors pasteText in src/component/prompt/index.tsx
  function collapse(text: string, virtualText: string) {
    const start = input.cursorOffset
    const end = start + promptOffsetWidth(virtualText)
    input.insertText(virtualText + " ")
    const id = input.extmarks.create({ start, end, virtual: true, typeId })
    map.set(id, parts.length)
    parts.push({ type: "text", text, source: { text: { start, end, value: virtualText } } })
    return id
  }

  // mirrors the inputText assembly in submit
  function submitText() {
    return expandTrackedPastedText(
      input.plainText,
      input.extmarks.getAllForTypeId(typeId).flatMap((extmark) => {
        const partIndex = map.get(extmark.id)
        const part = partIndex === undefined ? undefined : (parts[partIndex] as { type: string; text: string })
        if (part?.type !== "text") return []
        return [{ start: extmark.start, end: extmark.end, text: part.text }]
      }),
    )
  }

  return { setup, input, typeId, parts, map, collapse, submitText }
}

test("expands the placeholder on an identical second paste", async () => {
  const { setup, input, typeId, parts, map, collapse, submitText } = await createPrompt()
  try {
    collapse(CONTENT, PLACEHOLDER)
    expect(input.plainText).toBe(`${PLACEHOLDER} `)
    const before = submitText()
    expect(before).toBe(`${CONTENT} `)

    expect(expandPastedPlaceholder(input, typeId, map, parts, CONTENT)).toBe(true)

    expect(input.plainText).toBe(`${CONTENT} `)
    expect(input.plainText.split("line1").length - 1).toBe(1)
    expect(input.extmarks.getAllForTypeId(typeId)).toHaveLength(0)
    expect(submitText()).toBe(before)
  } finally {
    setup.renderer.destroy()
  }
})

test("leaves the placeholder alone when the second paste differs", async () => {
  const { setup, input, typeId, parts, map, collapse } = await createPrompt()
  try {
    collapse(CONTENT, PLACEHOLDER)

    expect(expandPastedPlaceholder(input, typeId, map, parts, OTHER)).toBe(false)

    expect(input.plainText).toBe(`${PLACEHOLDER} `)
    expect(input.extmarks.getAllForTypeId(typeId)).toHaveLength(1)
  } finally {
    setup.renderer.destroy()
  }
})

test("ignores a small paste that never collapsed", async () => {
  const { setup, input, typeId, parts, map } = await createPrompt()
  try {
    input.insertText("short paste")

    expect(expandPastedPlaceholder(input, typeId, map, parts, "short paste")).toBe(false)

    expect(input.plainText).toBe("short paste")
  } finally {
    setup.renderer.destroy()
  }
})

test("expands only the matching placeholder", async () => {
  const { setup, input, typeId, parts, map, collapse } = await createPrompt()
  try {
    collapse(CONTENT, PLACEHOLDER)
    const otherId = collapse(OTHER, OTHER_PLACEHOLDER)

    expect(expandPastedPlaceholder(input, typeId, map, parts, CONTENT)).toBe(true)

    expect(input.plainText).toBe(`${CONTENT} ${OTHER_PLACEHOLDER} `)
    const marks = input.extmarks.getAllForTypeId(typeId)
    expect(marks).toHaveLength(1)
    expect(marks[0].id).toBe(otherId)
    expect(input.plainText.slice(marks[0].start, marks[0].end)).toBe(OTHER_PLACEHOLDER)
  } finally {
    setup.renderer.destroy()
  }
})

test("expands the earlier of two identical placeholders", async () => {
  const { setup, input, typeId, parts, map, collapse } = await createPrompt()
  try {
    collapse(CONTENT, PLACEHOLDER)
    const secondId = collapse(CONTENT, PLACEHOLDER)

    expect(expandPastedPlaceholder(input, typeId, map, parts, CONTENT)).toBe(true)

    expect(input.plainText).toBe(`${CONTENT} ${PLACEHOLDER} `)
    const marks = input.extmarks.getAllForTypeId(typeId)
    expect(marks).toHaveLength(1)
    expect(marks[0].id).toBe(secondId)
  } finally {
    setup.renderer.destroy()
  }
})
