import { describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import { block } from "../../webview-ui/agent-manager/native-keys"
import { forward, forwardKey } from "../../webview-ui/src/utils/caret"

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

describe("forward with the Agent Manager shortcut blocker", () => {
  // Mount both real listeners in their real phases: Agent Manager blocks on
  // window capture, and VSCodeProvider moves the caret on document bubble.
  const setup = (mac: boolean) => {
    const window = new Window()
    const document = window.document
    const moves: string[][] = []
    // happy-dom has no Selection.modify, so record the call instead.
    Object.assign(document.getSelection(), { modify: (...args: string[]) => moves.push(args) })
    const unblock = block(window as unknown as globalThis.Window, mac)
    document.addEventListener("keydown", (e) => forward(e as unknown as KeyboardEvent, mac))
    const press = (target: EventTarget, init: { ctrl?: boolean; meta?: boolean } = {}) => {
      const event = new window.KeyboardEvent("keydown", {
        key: "f",
        keyCode: 70,
        ctrlKey: init.ctrl ?? true,
        metaKey: !!init.meta,
        bubbles: true,
        cancelable: true,
      })
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    return { document, moves, press, unblock }
  }

  it("moves the caret on macOS Ctrl+F in the prompt and rename fields", () => {
    const dom = setup(true)
    const prompt = dom.document.createElement("textarea")
    const rename = dom.document.createElement("input")
    dom.document.body.append(prompt, rename)

    expect(dom.press(prompt)).toBe(true)
    expect(dom.press(rename)).toBe(true)
    expect(dom.moves).toEqual([
      ["move", "forward", "character"],
      ["move", "forward", "character"],
    ])
    dom.unblock()
  })

  it("keeps blocking Ctrl+F and Cmd+F where they open search", () => {
    const mac = setup(true)
    const prompt = mac.document.createElement("textarea")
    const button = mac.document.createElement("button")
    mac.document.body.append(prompt, button)
    expect(mac.press(prompt, { ctrl: false, meta: true })).toBe(true)
    expect(mac.press(button)).toBe(true)
    expect(mac.moves).toEqual([])
    mac.unblock()

    const other = setup(false)
    const field = other.document.createElement("textarea")
    other.document.body.append(field)
    expect(other.press(field)).toBe(true)
    expect(other.moves).toEqual([])
    other.unblock()
  })

  it("leaves Ctrl+F to a text field that handles it", () => {
    const dom = setup(true)
    const field = dom.document.createElement("textarea")
    field.addEventListener("keydown", (e) => e.preventDefault())
    dom.document.body.append(field)

    expect(dom.press(field)).toBe(true)
    expect(dom.moves).toEqual([])
    dom.unblock()
  })
})
