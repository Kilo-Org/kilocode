import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { pastePlaceholder } from "../../webview-ui/src/components/chat/prompt-input-utils"
import { usePasteCollapse } from "../../webview-ui/src/hooks/usePasteCollapse"

const block = (tag: string) => Array.from({ length: 15 }, (_, index) => `${tag}${index}`).join("\n")
const first = block("a")
const second = block("b")
const chip = pastePlaceholder(first)

type Field = { value: string; selectionStart: number; selectionEnd: number }

function field(value: string, caret = value.length) {
  const el = {
    value,
    selectionStart: caret,
    selectionEnd: caret,
    focus() {},
    setSelectionRange(start: number, end: number) {
      el.selectionStart = start
      el.selectionEnd = end
    },
  }
  return el as unknown as Field & HTMLTextAreaElement
}

function clipboard(text: string) {
  return {
    defaultPrevented: false,
    preventDefault() {},
    clipboardData: { items: [], types: ["text/plain"], getData: () => text },
  } as unknown as ClipboardEvent
}

function keydown(key: string) {
  return { key, isComposing: false, preventDefault() {} } as unknown as KeyboardEvent
}

function setup() {
  const [text, setText] = createSignal("")
  const root = createRoot((dispose) => ({
    dispose,
    paste: usePasteCollapse({ enabled: () => true, text }),
    text,
    setText,
  }))
  return root
}

describe("usePasteCollapse", () => {
  it("leaves the caret after the inserted chip instead of inside the following text", () => {
    const ctx = setup()
    const el = field("helloworld", 5)

    ctx.paste.paste(clipboard(first), el, ctx.setText)

    expect(el.value).toBe(`hello ${chip} world`)
    expect(el.value.slice(el.selectionStart)).toBe("world")
    expect(el.selectionStart).toBe(el.selectionEnd)
    ctx.dispose()
  })

  it("keeps the surviving backing when the first of two identical chips is backspaced", () => {
    const ctx = setup()
    const el = field("")

    ctx.paste.paste(clipboard(first), el, ctx.setText)
    el.setSelectionRange(el.value.length, el.value.length)
    ctx.paste.paste(clipboard(second), el, ctx.setText)

    expect(ctx.text()).toBe(`${chip} ${chip}`)
    expect(ctx.paste.pastes().map((item) => item.text)).toEqual([first, second])

    el.setSelectionRange(chip.length, chip.length)
    const removed = ctx.paste.backspace(keydown("Backspace"), el, ctx.setText)

    expect(removed).toBe(true)
    expect(el.value).toBe(chip)
    expect(ctx.paste.plainText(el.value)).toBe(second)
    ctx.dispose()
  })

  it("restores the right backing when a chip is expanded after an earlier chip was removed", () => {
    const ctx = setup()
    const el = field("")

    ctx.paste.paste(clipboard(first), el, ctx.setText)
    el.setSelectionRange(el.value.length, el.value.length)
    ctx.paste.paste(clipboard(second), el, ctx.setText)

    el.setSelectionRange(chip.length, chip.length)
    ctx.paste.backspace(keydown("Backspace"), el, ctx.setText)

    const [only] = ctx.paste.pastes()
    const expanded = ctx.paste.expand(only!.id, el, ctx.setText)
    expect(expanded).toBe(true)
    expect(el.value).toBe(second)
    ctx.dispose()
  })

  it("writes a large expansion directly instead of through execCommand", () => {
    const ctx = setup()
    const el = field("")
    const backing = Array.from({ length: 120 }, (_, index) => `${index} ${"x".repeat(40)}`).join("\n")
    let calls = 0
    const global = globalThis as unknown as { document?: unknown }
    global.document = {
      execCommand: () => {
        calls += 1
        return true
      },
    }
    try {
      ctx.paste.paste(clipboard(backing), el, ctx.setText)
      expect(calls).toBe(1)

      const [entry] = ctx.paste.pastes()
      expect(ctx.paste.expand(entry!.id, el, ctx.setText)).toBe(true)
      expect(calls).toBe(1)
      expect(el.value).toBe(backing)
    } finally {
      delete global.document
    }
    ctx.dispose()
  })
})
