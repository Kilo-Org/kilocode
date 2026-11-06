import { afterAll, describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { actsOnList } from "../webview-ui/src/components/shared/model-selector-state"

const window = new Window()
const previous = Object.getOwnPropertyDescriptor(globalThis, "HTMLButtonElement")
Object.defineProperty(globalThis, "HTMLButtonElement", { value: window.HTMLButtonElement, configurable: true })

afterAll(() => {
  if (previous) Object.defineProperty(globalThis, "HTMLButtonElement", previous)
  else delete (globalThis as unknown as Record<string, unknown>).HTMLButtonElement
  window.close()
})

function key(value: string, target: EventTarget | null = null, extra: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key: value, isComposing: false, keyCode: 0, target, ...extra } as KeyboardEvent
}

describe("actsOnList", () => {
  test("claims arrows and Enter before the user enters list navigation", () => {
    for (const value of ["ArrowDown", "ArrowUp", "Enter"]) {
      expect(actsOnList(key(value), false)).toBe(true)
    }
  })

  test("claims Home, End, Left and Right only while navigating the list", () => {
    for (const value of ["Home", "End", "ArrowLeft", "ArrowRight"]) {
      expect(actsOnList(key(value), true)).toBe(true)
      expect(actsOnList(key(value), false)).toBe(false)
    }
  })

  test("leaves character keys and focused buttons to the input", () => {
    expect(actsOnList(key("a"), true)).toBe(false)
    expect(actsOnList(key(" "), false)).toBe(false)

    const button = window.document.createElement("button") as unknown as EventTarget
    expect(actsOnList(key("ArrowDown", button), true)).toBe(false)
    expect(actsOnList(key("Enter", button), true)).toBe(false)
  })

  test("does not claim Enter during IME composition", () => {
    expect(actsOnList(key("Enter", null, { isComposing: true }), false)).toBe(false)
  })
})
