import { describe, expect, test } from "bun:test"
import {
  clicks,
  clipboard,
  key,
  modifiers,
  point,
  pointer,
  printable,
  transition,
  typing,
  wheel,
} from "../../webview-ui/browser/stream-input"

const bounds = { left: 100, top: 50, width: 400, height: 200 }
const position = { clientX: 300, clientY: 100 }
const flags = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }
const keyboard = {
  ...flags,
  key: "a",
  code: "KeyA",
  keyCode: 65,
  repeat: false,
  isComposing: false,
  getModifierState: (_name: string) => false,
}
const insertion = { inputType: "insertText", isComposing: false }

function press(value: Partial<Parameters<typeof key>[0]> = {}) {
  return { ...keyboard, ...value }
}

describe("browser stream pointer input", () => {
  test("normalizes CSS coordinates and clamps captured drags outside the canvas", () => {
    expect(point(position, bounds)).toEqual({ x: 0.5, y: 0.25 })
    expect(point({ clientX: -10, clientY: 400 }, bounds)).toEqual({ x: 0, y: 1 })
    expect(point(position, { ...bounds, width: 0 })).toBeUndefined()
    expect(point(position, { ...bounds, height: -1 })).toBeUndefined()
    expect(point(position, { ...bounds, width: Infinity })).toBeUndefined()
    expect(point({ ...position, clientY: NaN }, bounds)).toBeUndefined()
  })

  test("preserves button state, click count, and CDP modifier bits", () => {
    const event = { ...position, ...flags, button: 2, buttons: 2, ctrlKey: true, shiftKey: true }
    expect(pointer(event, bounds, "down", 2)).toEqual({
      kind: "pointer",
      action: "down",
      x: 0.5,
      y: 0.25,
      button: "right",
      buttons: 2,
      clicks: 2,
      modifiers: 10,
    })
    expect(pointer({ ...event, button: -1 }, bounds, "move", 0)?.button).toBe("right")
    expect(pointer({ ...event, button: 1, buttons: 4 }, bounds, "down", 1)?.button).toBe("middle")
    expect(pointer({ ...event, button: 0, buttons: 0 }, bounds, "up", 1)?.buttons).toBe(0)
    expect(pointer({ ...event, button: 3, buttons: 8 }, bounds, "down", 1)).toBeUndefined()
    expect(modifiers({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toBe(15)
  })

  test("preserves chorded button transitions instead of coalescing them as movement", () => {
    const events = [
      { button: 0, buttons: 1 },
      { button: -1, buttons: 1 },
      { button: 2, buttons: 3 },
      { button: 0, buttons: 2 },
      { button: 2, buttons: 0 },
      { button: -1, buttons: 0 },
    ]
    expect(events.map((event) => transition(event) ?? "move")).toEqual(["down", "move", "down", "up", "up", "move"])
    expect(transition({ button: 1, buttons: 5 })).toBe("down")
    expect(transition({ button: 1, buttons: 1 })).toBe("up")
    expect(transition({ button: 3, buttons: 8 })).toBeUndefined()
  })

  test("scales pixel, line, and page wheel deltas without losing fractional pixels", () => {
    const event = { ...position, ...flags, deltaX: -0.5, deltaY: 2, deltaMode: 0 }
    expect(wheel(event, bounds)).toMatchObject({ x: 0.5, y: 0.25, deltaX: -0.5, deltaY: 2 })
    expect(wheel({ ...event, deltaMode: 1 }, bounds, 20)).toMatchObject({ deltaX: -10, deltaY: 40 })
    expect(wheel({ ...event, deltaMode: 2 }, bounds)).toMatchObject({ deltaX: -200, deltaY: 400 })
    expect(wheel({ ...event, deltaX: -20000, deltaY: 20000 }, bounds)).toMatchObject({
      deltaX: -10000,
      deltaY: 10000,
    })
    expect(wheel({ ...event, deltaY: Infinity }, bounds)).toBeUndefined()
    expect(wheel(event, { ...bounds, height: 0 })).toBeUndefined()
  })

  test("counts double clicks when pointer events have no native click detail", () => {
    const count = clicks()
    const event = { ...position, button: 0, timeStamp: 100 }
    expect(count.down(event)).toBe(1)
    expect(count.up()).toBe(1)
    expect(count.down({ ...event, clientX: 302, timeStamp: 200 })).toBe(2)
    expect(count.up()).toBe(2)
    expect(count.down({ ...event, timeStamp: 300 })).toBe(3)
    count.up()
    expect(count.down({ ...event, timeStamp: 900 })).toBe(1)
    count.up()
    expect(count.down({ ...event, button: 2, timeStamp: 1000 })).toBe(1)
  })

  test("does not turn a drag or a cancelled pointer into a double click", () => {
    const count = clicks()
    const event = { ...position, button: 0, timeStamp: 100 }
    count.down(event)
    count.move({ clientX: 350, clientY: 100 })
    count.move(position)
    count.up()
    expect(count.down({ ...event, timeStamp: 200 })).toBe(1)
    count.up()
    count.reset()
    expect(count.down({ ...event, timeStamp: 300 })).toBe(1)
  })
})

describe("browser stream keyboard input", () => {
  test("includes printable text with keydown but not shortcuts or key releases", () => {
    expect(printable(press())).toBe(true)
    expect(key(press(), "down")).toEqual({
      kind: "key",
      action: "down",
      key: "a",
      code: "KeyA",
      keyCode: 65,
      repeat: false,
      modifiers: 0,
      text: "a",
    })
    expect(key(press(), "up")?.text).toBeUndefined()
    expect(key(press({ ctrlKey: true }), "down")?.text).toBeUndefined()
    expect(key(press({ metaKey: true }), "down")?.text).toBeUndefined()
    expect(typing().input({ ...insertion, data: "a" }, "a")).toEqual({ kind: "text", text: "a" })
    expect(printable(press({ key: "A", shiftKey: true }))).toBe(true)
    expect(printable(press({ key: "é", altKey: true }))).toBe(true)
    expect(printable(press({ key: "𠮷" }))).toBe(true)
    expect(printable(press({ ctrlKey: true }))).toBe(false)
    expect(printable(press({ metaKey: true }))).toBe(false)
    expect(printable(press({ ctrlKey: true, altKey: true, getModifierState: (name) => name === "AltGraph" }))).toBe(
      true,
    )
  })

  test("forwards navigation keys, repeat state, and key releases", () => {
    for (const name of ["Tab", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Backspace", "Delete"]) {
      const event = press({ key: name, code: name, repeat: true, shiftKey: true })
      expect(printable(event)).toBe(false)
      expect(key(event, "down")).toMatchObject({ kind: "key", key: name, action: "down", repeat: true, modifiers: 8 })
      expect(key(event, "up")).toMatchObject({ key: name, action: "up" })
    }
  })

  test("does not forward IME processing or dead keys as raw input", () => {
    for (const name of ["Dead", "Process", "Unidentified", ""]) {
      expect(key(press({ key: name }), "down")).toBeUndefined()
    }
    expect(key(press({ isComposing: true }), "down")).toBeUndefined()
    expect(key(press({ keyCode: 229 }), "down")).toBeUndefined()
  })

  test("routes clipboard shortcuts to the host without confusing AltGraph text", () => {
    expect(clipboard(press({ key: "c", code: "KeyC", ctrlKey: true }))).toBe("copy")
    expect(clipboard(press({ key: "X", code: "KeyX", metaKey: true, shiftKey: true }))).toBe("cut")
    expect(clipboard(press({ key: "v", code: "KeyV", metaKey: true }))).toBe("paste")
    expect(clipboard(press({ key: "с", code: "KeyC", ctrlKey: true }))).toBe("copy")
    expect(clipboard(press({ key: "c", code: "KeyC" }))).toBeUndefined()
    expect(clipboard(press({ key: "v", code: "KeyV", ctrlKey: true, altKey: true }))).toBeUndefined()
    expect(clipboard(press({ key: "c", code: "KeyC", ctrlKey: true, getModifierState: () => true }))).toBeUndefined()
  })
})

describe("browser stream text composition", () => {
  test("uses committed text and ignores clipboard and raw-key input types", () => {
    const text = typing()
    expect(text.input({ ...insertion, data: null }, "word")).toEqual({ kind: "text", text: "word" })
    expect(text.input({ ...insertion, inputType: "insertReplacementText", data: "replacement" }, "old")).toEqual({
      kind: "text",
      text: "replacement",
    })
    for (const inputType of [
      "insertFromPaste",
      "insertFromDrop",
      "deleteByCut",
      "deleteContentBackward",
      "insertLineBreak",
    ]) {
      expect(text.input({ ...insertion, inputType, data: "text" }, "text")).toBeUndefined()
    }
  })

  test("commits composition once when input arrives before compositionend", () => {
    const text = typing()
    expect(text.start()).toEqual({ kind: "composition", text: "", start: 0, end: 0 })
    expect(text.update("日本")).toEqual({ kind: "composition", text: "日本", start: 2, end: 2 })
    expect(text.update("日本")).toBeUndefined()
    expect(
      text.input({ ...insertion, inputType: "insertCompositionText", data: "日本", isComposing: true }, "日本"),
    ).toBeUndefined()
    expect(text.end("日本")).toEqual({ kind: "text", text: "日本" })
    expect(text.active()).toBe(false)
    expect(text.end("日本")).toBeUndefined()
  })

  test("ignores the trailing commit input but permits the next identical character", () => {
    const text = typing()
    text.start()
    text.update("あ")
    expect(text.end("あ")).toEqual({ kind: "text", text: "あ" })
    text.prepare(press({ keyCode: 229 }))
    expect(text.input({ ...insertion, data: "あ" }, "あ")).toBeUndefined()
    text.prepare(press())
    expect(text.input({ ...insertion, data: "あ" }, "あ")).toEqual({ kind: "text", text: "あ" })
    text.start()
    text.end("あ")
    text.prepare(press())
    expect(text.input({ ...insertion, data: "あ" }, "あ")).toEqual({ kind: "text", text: "あ" })
  })

  test("suppresses composition-specific final events and clears cancelled composition", () => {
    const text = typing()
    text.start()
    text.update("𠮷")
    expect(text.update("𠮷a")).toEqual({ kind: "composition", text: "𠮷a", start: 3, end: 3 })
    text.end("𠮷a")
    expect(text.input({ ...insertion, inputType: "insertFromComposition", data: "𠮷a" }, "𠮷a")).toBeUndefined()
    text.start()
    text.update("draft")
    expect(text.end("")).toEqual({ kind: "composition", text: "", start: 0, end: 0 })
    text.start()
    text.update("discard")
    expect(text.reset()).toEqual({ kind: "composition", text: "", start: 0, end: 0 })
    expect(text.active()).toBe(false)
    expect(text.end("discard")).toBeUndefined()
    expect(text.reset()).toBeUndefined()
  })
})
