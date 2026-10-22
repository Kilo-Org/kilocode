/**
 * Motion budget for the chat webview.
 *
 * The chat animates the status shimmer, the spinner, and the agent avatars
 * while a session works. Those animations tick on the main thread, so a
 * window that is in the background keeps a renderer busy at the display
 * refresh rate. The budget is the smaller of what the user asked for and
 * what the window can afford.
 */

import { describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import { applyAnimations, reduceMotion, resolveAnimations } from "../../webview-ui/src/animations"

/** Install the happy-dom globals the webview code relies on, and return a restore function. */
function useDom(window: Window, names: string[]) {
  const restore: Array<() => void> = []
  for (const name of names) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name)
    const value = name === "window" ? window : (window as unknown as Record<string, unknown>)[name]
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
    restore.push(() => {
      if (previous) Object.defineProperty(globalThis, name, previous)
      else Reflect.deleteProperty(globalThis, name)
    })
  }
  return () => restore.forEach((fn) => fn())
}

describe("resolveAnimations", () => {
  it("keeps the full motion while the window is focused", () => {
    expect(resolveAnimations("full", true, false)).toBe("full")
    expect(resolveAnimations("reduced", true, false)).toBe("reduced")
  })

  it("pauses the motion while the window is not focused", () => {
    expect(resolveAnimations("full", false, false)).toBe("paused")
    expect(resolveAnimations("reduced", false, false)).toBe("paused")
  })

  it("pauses the motion while the view is hidden", () => {
    expect(resolveAnimations("full", true, true)).toBe("paused")
  })

  it("never adds motion back when the user turned it off", () => {
    expect(resolveAnimations("off", true, false)).toBe("off")
    expect(resolveAnimations("off", false, false)).toBe("off")
    expect(resolveAnimations("off", true, true)).toBe("off")
  })
})

describe("reduceMotion", () => {
  it("stops the script-driven motion the stylesheet cannot reach", () => {
    expect(reduceMotion("off")).toBe(true)
    expect(reduceMotion("paused")).toBe(true)
  })

  it("leaves the one-shot motion alone when the budget is reduced", () => {
    expect(reduceMotion("full")).toBe(false)
    expect(reduceMotion("reduced")).toBe(false)
  })
})

describe("applyAnimations", () => {
  // VS Code puts vscode-reduce-motion on the webview body when the user asked
  // for reduced motion, and it removes the class again on every style change.
  // Writing on it would take that setting away from the user.
  it("marks the chat without touching the host's class", () => {
    const window = new Window()
    const restore = useDom(window, ["window", "document"])
    const body = window.document.body
    body.classList.add("vscode-reduce-motion")
    try {
      applyAnimations("off", true)
      expect(body.classList.contains("kilo-reduce-motion")).toBe(true)
      expect(body.classList.contains("vscode-reduce-motion")).toBe(true)

      applyAnimations("full", true)
      expect(body.classList.contains("kilo-reduce-motion")).toBe(false)
      expect(body.classList.contains("vscode-reduce-motion")).toBe(true)
    } finally {
      restore()
    }
  })

  it("pauses the chat while the window is not focused", () => {
    const window = new Window()
    const restore = useDom(window, ["window", "document"])
    const body = window.document.body
    try {
      applyAnimations("full", false)
      expect(body.classList.contains("kilo-reduce-motion")).toBe(true)
    } finally {
      restore()
    }
  })

  it("puts the budget on the root element for the stylesheet", () => {
    const window = new Window()
    const restore = useDom(window, ["window", "document"])
    const root = window.document.documentElement
    try {
      applyAnimations("reduced", true)
      expect(root.dataset.animations).toBe("reduced")

      applyAnimations("full", true)
      expect(root.dataset.animations).toBeUndefined()
    } finally {
      restore()
    }
  })
})
