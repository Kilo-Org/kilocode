import { describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import { focusDiff, pageDiff } from "../../webview-ui/diff-viewer/review-scroll"

function setup() {
  const window = new Window()
  const doc = window.document
  doc.body.innerHTML = '<div tabindex="0"><span>selected text</span><textarea></textarea></div><textarea></textarea>'
  const viewport = doc.querySelector("div")!
  Object.defineProperties(viewport, { clientHeight: { value: 500 }, scrollHeight: { value: 2000 } })
  viewport.addEventListener("keydown", (event) =>
    pageDiff(event as unknown as KeyboardEvent & { currentTarget: HTMLDivElement }),
  )
  viewport.focus()
  const press = (opts: KeyboardEventInit = {}, target = viewport) => {
    const event = new window.KeyboardEvent("keydown", {
      key: "ArrowDown",
      shiftKey: true,
      bubbles: true,
      composed: true,
      cancelable: true,
      ...opts,
    })
    target.dispatchEvent(event)
    return event
  }
  return { doc, viewport, press }
}

describe("diff viewport page scrolling", () => {
  it("claims shadow reading clicks without cancelling selection or control clicks", () => {
    const window = new Window()
    const previous = Object.getOwnPropertyDescriptor(globalThis, "Element")
    Object.defineProperty(globalThis, "Element", { value: window.Element, configurable: true })
    try {
      const doc = window.document
      doc.body.innerHTML = '<div tabindex="0"><div></div></div>'
      const viewport = doc.querySelector("div")!
      const shadow = viewport.firstElementChild!.attachShadow({ mode: "open" })
      shadow.innerHTML =
        '<pre tabindex="0"><span>reading</span></pre><button>action</button><textarea></textarea><div contenteditable="true">comment</div><div role="treeitem" tabindex="0">file</div>'
      viewport.addEventListener("click", (event) =>
        focusDiff(event as unknown as MouseEvent & { currentTarget: HTMLDivElement }),
      )
      const pre = shadow.querySelector("pre")!
      pre.focus()
      const click = new window.MouseEvent("click", { bubbles: true, composed: true, cancelable: true })
      pre.firstElementChild!.dispatchEvent(click)
      expect(doc.activeElement).toBe(viewport)
      expect(click.defaultPrevented).toBe(false)
      for (const control of shadow.querySelectorAll<HTMLElement>("button, textarea, [contenteditable], [role]")) {
        control.focus()
        control.dispatchEvent(new window.MouseEvent("click", { bubbles: true, composed: true }))
        expect(shadow.activeElement).toBe(control)
      }
      const range = doc.createRange()
      range.selectNodeContents(pre)
      doc.getSelection()!.addRange(range)
      pre.dispatchEvent(new window.MouseEvent("click", { bubbles: true, composed: true, shiftKey: true }))
      expect(doc.getSelection()!.toString()).toBe("reading")
      expect(doc.activeElement).toBe(viewport)
    } finally {
      if (previous) Object.defineProperty(globalThis, "Element", previous)
      else Reflect.deleteProperty(globalThis, "Element")
    }
  })

  it("pages both ways with reading overlap and clamps at the ends", () => {
    const { viewport, press } = setup()
    expect(press().defaultPrevented).toBe(true)
    expect(viewport.scrollTop).toBe(460)
    press({ key: "ArrowUp" })
    expect(viewport.scrollTop).toBe(0)
    press({ key: "ArrowUp" })
    expect(viewport.scrollTop).toBe(0)
    viewport.scrollTop = 1490
    press()
    expect(viewport.scrollTop).toBe(1500)
  })

  it("leaves native keys, modifiers, composition and handled events alone", () => {
    const { viewport, press } = setup()
    for (const opts of [
      { shiftKey: false },
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { isComposing: true },
      ...["PageDown", "PageUp", " ", "ArrowLeft", "ArrowRight"].map((key) => ({ key })),
    ]) {
      expect(press(opts).defaultPrevented).toBe(false)
      expect(viewport.scrollTop).toBe(0)
    }
    viewport.addEventListener("keydown", (event) => event.preventDefault(), { capture: true })
    press()
    expect(viewport.scrollTop).toBe(0)
  })

  it("requires viewport focus and origin, including across shadow DOM", () => {
    const { doc, viewport, press } = setup()
    const child = viewport.querySelector("textarea")!
    press({}, child)
    child.focus()
    press({}, child)
    press()
    const shadow = viewport.attachShadow({ mode: "open" })
    const editor = doc.createElement("textarea")
    shadow.append(editor)
    editor.focus()
    press({}, editor)
    viewport.focus()
    press({}, editor)
    doc.querySelector("body > textarea")!.focus()
    press()
    expect(viewport.scrollTop).toBe(0)
  })

  it("preserves selected text", () => {
    const { doc, viewport, press } = setup()
    const range = doc.createRange()
    range.selectNodeContents(viewport.querySelector("span")!)
    doc.getSelection()!.addRange(range)
    expect(press().defaultPrevented).toBe(false)
    expect(press({ key: "ArrowUp" }).defaultPrevented).toBe(false)
    expect(viewport.scrollTop).toBe(0)
    expect(doc.getSelection()!.toString()).toBe("selected text")
  })
})
