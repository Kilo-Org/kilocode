import { describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import { forwardKey } from "../../webview-ui/src/utils/caret"

describe("forwardKey", () => {
  const document = new Window().document
  const textarea = document.createElement("textarea")
  const input = document.createElement("input")
  const editor = document.createElement("div")
  editor.contentEditable = "true"
  const box = document.createElement("input")
  box.type = "checkbox"
  const select = document.createElement("select")
  const button = document.createElement("button")

  const chord = (
    target: unknown,
    init: { key?: string; code?: number; ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {},
    prevented = false,
  ) =>
    ({
      target,
      key: init.key ?? "f",
      keyCode: init.code ?? 70,
      ctrlKey: init.ctrl ?? true,
      metaKey: !!init.meta,
      shiftKey: !!init.shift,
      altKey: !!init.alt,
      defaultPrevented: prevented,
    }) as unknown as KeyboardEvent

  it("moves the caret for Ctrl+F in macOS text fields", () => {
    expect(forwardKey(chord(textarea), true)).toBe(true)
    expect(forwardKey(chord(input), true)).toBe(true)
    expect(forwardKey(chord(editor), true)).toBe(true)
  })

  it("matches keyCode like VS Code on non-Latin layouts", () => {
    expect(forwardKey(chord(textarea, { key: "а" }), true)).toBe(true)
  })

  it("ignores other platforms, modifiers, and keys", () => {
    expect(forwardKey(chord(textarea), false)).toBe(false)
    expect(forwardKey(chord(textarea, { meta: true }), true)).toBe(false)
    expect(forwardKey(chord(textarea, { ctrl: false, meta: true }), true)).toBe(false)
    expect(forwardKey(chord(textarea, { shift: true }), true)).toBe(false)
    expect(forwardKey(chord(textarea, { alt: true }), true)).toBe(false)
    expect(forwardKey(chord(textarea, { key: "b", code: 66 }), true)).toBe(false)
  })

  it("ignores controls without a caret", () => {
    expect(forwardKey(chord(box), true)).toBe(false)
    expect(forwardKey(chord(select), true)).toBe(false)
    expect(forwardKey(chord(button), true)).toBe(false)
    expect(forwardKey(chord(document.body), true)).toBe(false)
  })

  it("leaves Ctrl+F alone when another handler already took it", () => {
    expect(forwardKey(chord(textarea, {}, true), true)).toBe(false)
  })
})
