import { describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import {
  DIFF_PANEL_SCROLLER,
  REVIEW_SCROLLER,
  diffToggleIntent,
  focusDiffScroller,
} from "../../webview-ui/agent-manager/diff-focus"
import { createChatFocus } from "../../webview-ui/agent-manager/focus"
import { createDiffPanelFocus } from "../../webview-ui/agent-manager/diff-panel-focus"
import { createTabFocus } from "../../webview-ui/src/utils/tab-navigation"
import {
  FOCUS_REGION_ATTRIBUTE,
  isFocusRegion,
  ownsFocusRegion,
  pasteToPrompt,
  releaseFocusRegion,
} from "../../webview-ui/src/utils/focus"

/** Install happy-dom globals the webview code relies on, and return a restore function. */
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

describe("diff keyboard focus", () => {
  it("releases a viewport on an outside click without cancelling native control behavior", () => {
    const window = new Window()
    const doc = window.document
    doc.body.innerHTML =
      '<div data-focus-region tabindex="0"><span>diff</span><textarea></textarea></div><button>outside</button>'
    const region = doc.querySelector<HTMLElement>("[data-focus-region]")!
    doc.addEventListener("pointerdown", (event) => releaseFocusRegion(event, doc), true)
    region.focus()
    region.firstElementChild!.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }))
    expect(doc.activeElement).toBe(region)
    const event = new window.PointerEvent("pointerdown", { bubbles: true, cancelable: true })
    doc.querySelector("button")!.dispatchEvent(event)
    expect(doc.activeElement).toBe(doc.body)
    expect(event.defaultPrevented).toBe(false)
    const host = doc.createElement("div")
    region.append(host)
    const shadow = host.attachShadow({ mode: "open" })
    shadow.innerHTML = '<pre tabindex="0">nested diff</pre><textarea></textarea>'
    shadow.querySelector<HTMLElement>("pre")!.focus()
    expect(doc.activeElement).toBe(host)
    doc.querySelector("button")!.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }))
    expect(doc.activeElement).toBe(doc.body)
    const comment = shadow.querySelector("textarea")!
    comment.focus()
    doc.querySelector("button")!.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }))
    expect(shadow.activeElement).toBe(comment)
    const editor = doc.querySelector("textarea")!
    editor.focus()
    doc.querySelector("button")!.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }))
    expect(doc.activeElement).toBe(editor)
  })

  it("routes an explicit paste to the prompt but preserves native paste in editors", () => {
    const window = new Window()
    const restore = useDom(window, ["document", "Element"])
    const doc = window.document
    doc.body.innerHTML = '<div data-focus-region tabindex="0"></div><textarea></textarea><input>'
    const prompt = doc.querySelector("textarea")!
    // happy-dom has no layout engine.
    prompt.getClientRects = () => [{ width: 100, height: 40 }] as DOMRectList
    let pasted = 0
    doc.addEventListener("paste", (event) =>
      pasteToPrompt(event, prompt, (event) => {
        pasted++
        event.preventDefault()
      }),
    )
    try {
      const region = doc.querySelector<HTMLElement>("[data-focus-region]")!
      region.focus()
      region.dispatchEvent(new window.ClipboardEvent("paste", { bubbles: true, cancelable: true }))
      expect(doc.activeElement).toBe(prompt)
      expect(pasted).toBe(1)
      const editor = doc.querySelector("input")!
      editor.focus()
      const event = new window.ClipboardEvent("paste", { bubbles: true, cancelable: true })
      editor.dispatchEvent(event)
      expect(doc.activeElement).toBe(editor)
      expect(event.defaultPrevented).toBe(false)
      expect(pasted).toBe(1)
      const host = doc.createElement("div")
      doc.body.append(host)
      const shadow = host.attachShadow({ mode: "open" })
      shadow.innerHTML = "<textarea></textarea>"
      shadow
        .querySelector("textarea")!
        .dispatchEvent(new window.ClipboardEvent("paste", { bubbles: true, composed: true, cancelable: true }))
      host.className = "xterm"
      host.dispatchEvent(new window.ClipboardEvent("paste", { bubbles: true, cancelable: true }))
      expect(pasted).toBe(1)
    } finally {
      restore()
    }
  })

  it("decides the toggle intent from the open and focus state", () => {
    expect(diffToggleIntent(false, false)).toBe("open")
    expect(diffToggleIntent(false, true)).toBe("open")
    expect(diffToggleIntent(true, false)).toBe("focus")
    expect(diffToggleIntent(true, true)).toBe("close")
  })

  it("detects focus regions and their descendants", () => {
    const window = new Window()
    const region = window.document.createElement("div")
    region.setAttribute(FOCUS_REGION_ATTRIBUTE, "")
    region.tabIndex = 0
    const child = window.document.createElement("button")
    region.append(child)
    window.document.body.append(region)

    expect(isFocusRegion(region)).toBe(true)
    expect(isFocusRegion(child)).toBe(false)
    expect(ownsFocusRegion(region)).toBe(true)
    expect(ownsFocusRegion(child)).toBe(true)
    expect(ownsFocusRegion(window.document.body)).toBe(false)
    expect(ownsFocusRegion(null)).toBe(false)
  })

  it("focuses the matching diff scroller", () => {
    const window = new Window()
    const panel = window.document.createElement("div")
    panel.className = "am-diff-panel-cache-active"
    const scroller = window.document.createElement("div")
    scroller.className = "am-diff-content"
    scroller.tabIndex = 0
    panel.append(scroller)
    window.document.body.append(panel)

    expect(focusDiffScroller(DIFF_PANEL_SCROLLER, window.document)).toBe(true)
    expect(window.document.activeElement).toBe(scroller)
    expect(focusDiffScroller(REVIEW_SCROLLER, window.document)).toBe(false)
  })

  it("keeps prompt focus recovery from stealing a focused diff region", async () => {
    const window = new Window()
    const document = window.document
    document.hasFocus = () => true
    const frames: FrameRequestCallback[] = []
    const restore = useDom(window, ["document", "window", "CustomEvent"])
    const raf = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame")
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      value: (callback: FrameRequestCallback) => frames.push(callback),
      configurable: true,
      writable: true,
    })
    const region = document.createElement("div")
    region.setAttribute(FOCUS_REGION_ATTRIBUTE, "")
    region.tabIndex = 0
    const prompt = document.createElement("textarea")
    prompt.className = "prompt-input"
    document.body.append(region, prompt)
    let requested = 0
    window.addEventListener("focusPrompt", () => requested++)

    try {
      const focus = createChatFocus({ term: () => undefined, history: () => false, review: () => false })
      region.focus()
      focus()
      await Promise.resolve()
      while (frames.length) frames.shift()?.(0)
      expect(document.activeElement).toBe(region)
      expect(requested).toBe(0)

      region.blur()
      focus()
      await Promise.resolve()
      while (frames.length) frames.shift()?.(0)
      expect(requested).toBeGreaterThan(0)
    } finally {
      restore()
      if (raf) Object.defineProperty(globalThis, "requestAnimationFrame", raf)
      else Reflect.deleteProperty(globalThis, "requestAnimationFrame")
      await window.happyDOM.close()
    }
  })

  it("allows forced prompt focus while a diff region owns focus", async () => {
    const window = new Window()
    const document = window.document
    document.hasFocus = () => true
    const frames: FrameRequestCallback[] = []
    const restore = useDom(window, ["document", "window", "CustomEvent"])
    const raf = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame")
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      value: (callback: FrameRequestCallback) => frames.push(callback),
      configurable: true,
      writable: true,
    })
    const region = document.createElement("div")
    region.setAttribute(FOCUS_REGION_ATTRIBUTE, "")
    region.tabIndex = 0
    document.body.append(region)
    const details: Array<Record<string, unknown>> = []
    const prompt = document.createElement("textarea")
    document.body.append(prompt)
    window.addEventListener("focusPrompt", (event) => {
      details.push((event as CustomEvent).detail ?? {})
      prompt.focus()
    })

    try {
      const focus = createChatFocus({ term: () => undefined, history: () => false, review: () => false })
      region.focus()
      focus(true)
      await Promise.resolve()
      expect(document.activeElement).toBe(prompt)
      region.focus()
      while (frames.length) frames.shift()?.(0)
      expect(details).toEqual([{ restore: true, force: true, deferFocusToQuestion: false }])
      expect(document.activeElement).toBe(region)
    } finally {
      restore()
      if (raf) Object.defineProperty(globalThis, "requestAnimationFrame", raf)
      else Reflect.deleteProperty(globalThis, "requestAnimationFrame")
      await window.happyDOM.close()
    }
  })
})

describe("diff panel focus controller", () => {
  it("hands queued review focus to the side viewport, but restores the tab on a normal close", () => {
    const window = new Window()
    const restore = useDom(window, ["document", "HTMLElement", "requestAnimationFrame"])
    const doc = window.document
    const frames: FrameRequestCallback[] = []
    globalThis.requestAnimationFrame = (run) => frames.push(run)
    doc.body.innerHTML =
      '<button role="tab" aria-selected="true">chat</button><div class="am-review-diff" data-focus-region tabindex="0"></div><div class="am-diff-panel-cache-active"><div class="am-diff-content" data-focus-region tabindex="0"></div></div><input>'
    const tab = doc.querySelector<HTMLElement>("button")!
    const review = doc.querySelector<HTMLElement>(".am-review-diff")!
    const side = doc.querySelector<HTMLElement>(".am-diff-content")!
    const editor = doc.querySelector("input")!
    const tabs = createTabFocus({ ids: () => [], select: () => {} })
    const controller = createDiffPanelFocus({
      isOpen: () => false,
      open: (focus) => {
        review.remove()
        if (!focus) tabs.restore()
      },
      close: () => {},
      closeHistory: () => {},
      focusPrompt: () => {},
      track: () => {},
      doc,
    })
    const flush = () => {
      while (frames.length) frames.shift()?.(0)
    }
    try {
      review.focus()
      controller.toggleCommand()
      expect(doc.activeElement).not.toBe(side)
      flush()
      expect(doc.activeElement).toBe(side)
      tabs.restore()
      expect(doc.activeElement).toBe(side)
      flush()
      expect(doc.activeElement).toBe(tab)
      controller.toggleCommand()
      editor.focus()
      flush()
      expect(doc.activeElement).toBe(editor)
    } finally {
      restore()
    }
  })

  it("reveals only a mounted writable intended prompt, including one hidden by review", () => {
    const window = new Window()
    const restore = useDom(window, ["document", "Element"])
    const doc = window.document
    doc.body.innerHTML =
      '<div data-focus-region tabindex="0"></div><div class="am-chat-wrapper am-chat-wrapper-hidden"><textarea class="prompt-input"></textarea></div><div class="chat am-chat-wrapper" style="display:none"><textarea class="prompt-input"></textarea></div><input><div class="xterm" tabindex="0"></div>'
    const region = doc.querySelector<HTMLElement>("[data-focus-region]")!
    const chat = doc.querySelector<HTMLElement>(".chat")!
    const prompt = chat.querySelector("textarea")!
    const calls: string[] = []
    let target: HTMLTextAreaElement | undefined = prompt
    const controller = createDiffPanelFocus({
      isOpen: () => true,
      open: () => {},
      close: () => {},
      closeHistory: () => calls.push("history"),
      focusPrompt: () => {},
      revealPrompt: () => {
        calls.push("reveal")
        chat.style.display = ""
      },
      track: () => {},
      doc,
    })
    const dispose = controller.listen()
    const paste = (node: Element = region) => {
      const event = new window.ClipboardEvent("paste", { bubbles: true, cancelable: true })
      node.dispatchEvent(event)
      return event
    }
    // The bubble handler uses the same destination after capture reveals it.
    prompt.getClientRects = () => (chat.style.display === "none" ? [] : [{}]) as DOMRectList
    doc.addEventListener("paste", (event) =>
      pasteToPrompt(event, target, (event) => {
        calls.push("paste")
        event.preventDefault()
      }),
    )
    try {
      for (const state of ["missing", "readonly", "blocked", "disabled", "detached"]) {
        target = state === "missing" ? undefined : prompt
        chat.classList.toggle("am-chat-wrapper-hidden", state === "missing")
        prompt.readOnly = state === "readonly"
        prompt.disabled = state === "disabled"
        prompt.setAttribute("aria-disabled", String(state === "blocked"))
        if (state === "detached") prompt.remove()
        expect(paste().defaultPrevented).toBe(false)
        expect(calls).toEqual([])
        expect(chat.style.display).toBe("none")
      }
      chat.append(prompt)
      expect(paste().defaultPrevented).toBe(true)
      expect(calls).toEqual(["history", "reveal", "paste"])
      expect(doc.activeElement).toBe(prompt)
      calls.length = 0
      expect(paste().defaultPrevented).toBe(true)
      expect(calls).toEqual(["history", "reveal", "paste"])
      calls.length = 0
      for (const attr of ["inert", "aria-hidden"]) {
        if (attr === "inert") chat.setAttribute("inert", "")
        else chat.setAttribute("aria-hidden", "true")
        expect(paste().defaultPrevented).toBe(false)
        expect(calls).toEqual([])
        chat.removeAttribute(attr)
      }
      for (const selector of ["input", ".xterm"]) {
        expect(paste(doc.querySelector(selector)!).defaultPrevented).toBe(false)
        expect(calls).toEqual([])
      }
    } finally {
      dispose()
      restore()
    }
  })

  const setup = (frame: (run: () => void) => void = (run) => run()) => {
    const window = new Window()
    const doc = window.document
    const panel = doc.createElement("div")
    panel.className = "am-diff-panel-cache-active"
    const scroller = doc.createElement("div")
    scroller.className = "am-diff-content"
    scroller.tabIndex = 0
    scroller.setAttribute(FOCUS_REGION_ATTRIBUTE, "")
    panel.append(scroller)
    const prompt = doc.createElement("textarea")
    prompt.tabIndex = 0
    doc.body.append(panel, prompt)
    const calls: string[] = []
    let open = false
    const controller = createDiffPanelFocus({
      isOpen: () => open,
      open: () => calls.push("open"),
      close: () => calls.push("close"),
      closeHistory: () => calls.push("history"),
      focusPrompt: () => calls.push("prompt"),
      track: (action) => calls.push(`track:${action}`),
      schedule: (run) => run(),
      frame,
      doc,
    })
    return { doc, scroller, prompt, calls, controller, setOpen: (value: boolean) => (open = value) }
  }

  it("guards delete keys inside diff viewports and their surrounding chrome", () => {
    const { doc, scroller, controller } = setup()
    const panel = doc.querySelector(".am-diff-panel-cache-active")!
    panel.className = "am-diff-panel"
    const header = doc.createElement("button")
    panel.append(header)
    const review = doc.createElement("div")
    review.className = "am-review-layout"
    const reviewHeader = doc.createElement("button")
    review.append(reviewHeader)
    doc.body.append(review)
    const outside = doc.createElement("button")
    doc.body.append(outside)
    expect(controller.isFocusTarget(scroller)).toBe(true)
    expect(controller.isFocusTarget(header)).toBe(true)
    expect(controller.isFocusTarget(reviewHeader)).toBe(true)
    expect(controller.isFocusTarget(outside)).toBe(false)
    expect(controller.isFocusTarget(null)).toBe(false)
  })

  it("opens and focuses the viewport from the shortcut", () => {
    const { doc, scroller, calls, controller } = setup()
    controller.toggleCommand()
    expect(calls).toEqual(["open"])
    expect(doc.activeElement).toBe(scroller)
  })

  it("does not steal focus from a control selected before the viewport focus runs", () => {
    const frames: Array<() => void> = []
    const state = setup((run) => frames.push(run))
    state.controller.openPanel(true)
    state.prompt.focus()
    while (frames.length) frames.shift()?.()
    expect(state.doc.activeElement).toBe(state.prompt)
  })

  it("closes an already focused viewport and restores the opener", () => {
    const { doc, scroller, prompt, calls, controller, setOpen } = setup()
    prompt.focus()
    controller.openPanel(true)
    expect(doc.activeElement).toBe(scroller)
    setOpen(true)
    controller.toggleCommand()
    expect(calls).toEqual(["open", "close", "history"])
    expect(doc.activeElement).toBe(prompt)
  })

  it("focuses the viewport when it is open but focus is elsewhere", () => {
    const { doc, scroller, prompt, calls, controller, setOpen } = setup()
    setOpen(true)
    prompt.focus()
    controller.toggleCommand()
    expect(calls).toEqual([])
    expect(doc.activeElement).toBe(scroller)
  })

  it("falls back to the prompt when the opener is gone", () => {
    const { prompt, calls, controller, setOpen } = setup()
    prompt.focus()
    controller.openPanel(true)
    prompt.remove()
    setOpen(true)
    controller.toggleCommand()
    expect(calls).toEqual(["open", "close", "history", "prompt"])
  })

  it("keeps an external opener when focus moves between diff modes", () => {
    const { doc, scroller, prompt, calls, controller, setOpen } = setup()
    prompt.focus()
    controller.openPanel(true)
    expect(calls).toEqual(["open"])
    scroller.focus()
    controller.openPanel(true)
    setOpen(true)
    controller.toggleCommand()
    expect(doc.activeElement).toBe(prompt)
  })

  it("restores the prompt when the shortcut refocuses an open panel", () => {
    const { doc, scroller, prompt, controller, setOpen } = setup()
    const button = doc.createElement("button")
    doc.body.append(button)
    button.focus()
    controller.openPanel(false)
    prompt.focus()
    setOpen(true)
    controller.toggleCommand()
    expect(doc.activeElement).toBe(scroller)
    controller.toggleCommand()
    expect(doc.activeElement).toBe(prompt)
  })

  it("ignores the shortcut while an editor inside the viewport is focused", () => {
    const { doc, scroller, calls, controller, setOpen } = setup()
    const editor = doc.createElement("textarea")
    scroller.append(editor)
    editor.focus()
    setOpen(true)
    controller.toggleCommand()
    expect(calls).toEqual([])
    expect(doc.activeElement).toBe(editor)
  })

  it("tracks and toggles from the toolbar", () => {
    const { calls, controller } = setup()
    controller.toggleToolbar()
    expect(calls).toEqual(["track:open", "open"])
  })
})
