// Focus requests follow the main tab of the visible context: a terminal tab keeps or takes focus in its terminal, a
// session tab focuses its composer, and no request switches tabs or creates a session to have a focus target.
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import {
  createFocusBridge,
  createMainFocus,
  dropForeignTerminal,
  keepsFocus,
  terminalActivation,
  terminalHasFocus,
} from "../webview-ui/agent-manager/focus"

function bridge(terminal: string | undefined) {
  const calls: string[] = []
  const ctl = createFocusBridge({
    prompt: { active: () => false, focus: () => calls.push("prompt") },
    post: (target) => calls.push(`post:${target}`),
    remember: () => calls.push("remember"),
    terminal: () => terminal,
    focusTerminal: (id) => calls.push(`terminal:${id}`),
  })
  return { ctl, calls }
}

describe("Agent Manager main focus", () => {
  it("keeps Cmd+Shift+M in the terminal of a terminal main tab", () => {
    const test = bridge("terminal:1")

    test.ctl.focus()

    expect(test.calls).toEqual(["terminal:terminal:1", "post:mainTerminal"])
  })

  it("focuses the composer of a session main tab", () => {
    const test = bridge(undefined)

    test.ctl.focus()

    expect(test.calls).toEqual(["prompt", "post:prompt"])
  })

  it("hands focus back to the main surface after a side panel closes", () => {
    const calls: string[] = []
    const focus = createMainFocus({
      terminal: () => "terminal:main",
      focusTerminal: (id) => calls.push(`terminal:${id}`),
      prompt: (force) => calls.push(`prompt:${force}`),
    })

    expect(focus()).toBe("mainTerminal")
    expect(calls).toEqual(["terminal:terminal:main"])
  })

  it("leaves a focused text field alone on an automatic request, but not on the shortcut", () => {
    const calls: string[] = []
    const focus = createMainFocus({
      terminal: () => "terminal:main",
      focusTerminal: (id) => calls.push(id),
      prompt: () => calls.push("prompt"),
      keeps: () => true,
    })

    // Window refocus while the sidebar search or a worktree rename input has the caret.
    focus()
    expect(calls).toEqual([])

    // Cmd+Shift+M is explicit.
    focus(true)
    expect(calls).toEqual(["terminal:main"])
  })

  it("passes the force flag to the composer focus", () => {
    const calls: boolean[] = []
    const focus = createMainFocus({
      terminal: () => undefined,
      focusTerminal: () => undefined,
      prompt: (force) => calls.push(force),
    })

    expect(focus(true)).toBe("prompt")
    expect(focus()).toBe("prompt")
    expect(calls).toEqual([true, false])
  })
})

describe("dropForeignTerminal", () => {
  const state = (active: string | undefined, contexts: Record<string, string>, current: string | undefined) => {
    let id = active
    return {
      activeId: () => id,
      setActiveId: (next: undefined) => {
        id = next
      },
      contextFor: (terminal: string) => contexts[terminal],
      currentKey: () => current,
    }
  }

  it("clears a main terminal of the context the selection left", () => {
    const terms = state("terminal:local", { "terminal:local": "p:local" }, "p:wt-1")

    dropForeignTerminal(terms)

    expect(terms.activeId()).toBeUndefined()
  })

  it("keeps the main terminal of the selected context", () => {
    const terms = state("terminal:wt", { "terminal:wt": "p:wt-1" }, "p:wt-1")

    dropForeignTerminal(terms)

    expect(terms.activeId()).toBe("terminal:wt")
  })
})

describe("terminalActivation", () => {
  const base = { active: true, wasActive: true, serial: 0, previous: 0, focusOnActivate: true }

  it("focuses a main terminal when it becomes visible", () => {
    expect(terminalActivation({ ...base, wasActive: false })).toEqual({ focus: true })
  })

  it("repaints a side terminal on activation without taking focus", () => {
    expect(terminalActivation({ ...base, wasActive: false, focusOnActivate: false })).toEqual({ focus: false })
  })

  it("focuses a visible terminal on a new focus request", () => {
    expect(terminalActivation({ ...base, serial: 4, previous: 3 })).toEqual({ focus: true })
  })

  it("keeps a visible main terminal quiet when the request moves to the side terminal", () => {
    // Cmd+/ from a focused main terminal: the side terminal gets the request, the main serial drops to 0.
    expect(terminalActivation({ ...base, serial: 0, previous: 3 })).toBeUndefined()
  })

  it("does nothing for a hidden terminal", () => {
    expect(terminalActivation({ ...base, active: false, serial: 5, previous: 4 })).toBeUndefined()
  })
})

describe("keepsFocus", () => {
  // A real DOM: the selection check walks from the anchor node to its element.
  const window = new Window({ url: "http://localhost" })
  const doc = window.document as unknown as Document
  const element = (html: string) => {
    doc.body.innerHTML = html
    return doc.body.firstElementChild as Element
  }
  beforeAll(() => Object.assign(globalThis, { Element: window.Element }))
  afterAll(() => {
    delete (globalThis as { Element?: unknown }).Element
  })

  it("lets an automatic request focus the terminal from the page body", () => {
    doc.body.innerHTML = ""
    expect(keepsFocus(doc.body, doc)).toBe(false)
  })

  it("keeps a text field such as the sidebar search or a worktree rename", () => {
    expect(keepsFocus(element("<input type=text>"), doc)).toBe(true)
  })

  it("keeps an open popup and a focus region", () => {
    const popup = element('<div><div class="popup-selector" data-expanded></div><button></button></div>')
    expect(keepsFocus(popup.querySelector("button"), doc)).toBe(true)
    const region = element("<div data-focus-region><button></button></div>")
    expect(keepsFocus(region.querySelector("button"), doc)).toBe(true)
  })

  it("keeps a text selection in the transcript", () => {
    const text = element("<p>selected answer</p>")
    doc.getSelection()!.selectAllChildren(text)
    expect(keepsFocus(doc.body, doc)).toBe(true)
    doc.getSelection()!.removeAllRanges()
  })

  it("does not treat a terminal textarea as a control to keep", () => {
    const layer = element(
      '<div class="am-side-terminal-layer"><div class="am-terminal-host"><textarea></textarea></div></div>',
    )
    expect(keepsFocus(layer.querySelector("textarea"), doc)).toBe(false)
  })
})

describe("terminalHasFocus", () => {
  const element = (selector: string | undefined) =>
    ({
      matches: () => false,
      closest: (query: string) => (query === selector ? {} : null),
    }) as unknown as Element

  it("detects main and side terminals", () => {
    expect(terminalHasFocus(element(".am-terminal-layer .am-terminal-host"))).toBe(true)
    expect(terminalHasFocus(element(".am-side-terminal-layer .am-terminal-host"))).toBe(true)
  })

  it("does not treat other controls as a terminal", () => {
    expect(terminalHasFocus(element(undefined))).toBe(false)
    expect(terminalHasFocus(null)).toBe(false)
  })
})
