import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"

const observers: Array<() => void> = []

mock.module("@solid-primitives/resize-observer", () => ({
  createResizeObserver: (_source: () => HTMLElement | undefined, callback: () => void) => {
    observers.push(callback)
  },
}))

const originalElement = globalThis.Element
const originalWheelEvent = globalThis.WheelEvent

type Listener = {
  callback: (event: Event) => void
  capture: boolean
}

class FakeElement {
  scrollHeight = 100
  clientHeight = 100
  scrollTop = 0
  style = { overflowAnchor: "" }
  private listeners = new Map<string, Listener[]>()

  closest() {
    return null
  }

  scrollTo(options: ScrollToOptions) {
    this.scrollTop = options.top ?? this.scrollTop
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) {
    const callback = typeof listener === "function" ? listener : (event: Event) => listener.handleEvent(event)
    const capture = typeof options === "boolean" ? options : (options?.capture ?? false)
    const listeners = this.listeners.get(type) ?? []
    listeners.push({ callback, capture })
    this.listeners.set(type, listeners)
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) {
    const capture = typeof options === "boolean" ? options : (options?.capture ?? false)
    const listeners = this.listeners.get(type) ?? []
    this.listeners.set(
      type,
      listeners.filter((item) => item.callback !== listener || item.capture !== capture),
    )
  }

  fire(type: string, event: Event) {
    const listeners = this.listeners.get(type) ?? []
    for (const item of listeners.toSorted((a, b) => Number(b.capture) - Number(a.capture))) {
      item.callback(event)
    }
  }
}

class FakeWheelEvent {
  constructor(
    readonly deltaY: number,
    readonly target: FakeElement,
  ) {}
}

globalThis.Element = FakeElement as unknown as typeof Element
globalThis.WheelEvent = FakeWheelEvent as unknown as typeof WheelEvent

const { createAutoScroll } = await import("./create-auto-scroll")

function setup(options?: { interacted?: () => void; working?: boolean }) {
  const el = new FakeElement()
  const root = createRoot((dispose) => ({
    dispose,
    scroll: createAutoScroll({
      working: () => options?.working ?? false,
      onUserInteracted: options?.interacted,
    }),
  }))
  root.scroll.scrollRef(el as unknown as HTMLElement)
  root.scroll.contentRef(new FakeElement() as unknown as HTMLElement)

  const resize = (index?: number) => {
    if (index !== undefined) {
      observers[index]?.()
      return
    }
    observers.forEach((callback) => callback())
  }

  return { ...root, el, resize }
}

beforeEach(() => {
  observers.length = 0
})

afterAll(() => {
  if (originalElement) globalThis.Element = originalElement
  else Reflect.deleteProperty(globalThis, "Element")
  if (originalWheelEvent) globalThis.WheelEvent = originalWheelEvent
  else Reflect.deleteProperty(globalThis, "WheelEvent")
})

describe("createAutoScroll non-scrollable layouts", () => {
  test("preserves an established pause through temporary non-overflow", () => {
    const ctx = setup()
    ctx.el.scrollHeight = 300
    ctx.el.scrollTop = 80
    ctx.scroll.pause()

    ctx.el.scrollHeight = 100
    ctx.el.scrollTop = 0
    ctx.scroll.handleScroll()
    expect(ctx.scroll.userScrolled()).toBe(true)

    ctx.resize(0)
    expect(ctx.scroll.userScrolled()).toBe(true)

    ctx.resize(1)
    expect(ctx.scroll.userScrolled()).toBe(true)

    ctx.el.scrollHeight = 300
    ctx.el.scrollTop = 80
    ctx.resize()

    expect(ctx.scroll.userScrolled()).toBe(true)
    expect(ctx.el.scrollTop).toBe(80)
    ctx.dispose()
  })

  test("allows session restoration to pause before content overflows", () => {
    const ctx = setup()
    ctx.scroll.pause()

    expect(ctx.scroll.userScrolled()).toBe(true)

    ctx.el.scrollHeight = 300
    ctx.el.scrollTop = 60
    ctx.resize()

    expect(ctx.scroll.userScrolled()).toBe(true)
    expect(ctx.el.scrollTop).toBe(60)

    ctx.scroll.resume()

    expect(ctx.scroll.userScrolled()).toBe(false)
    expect(ctx.el.scrollTop).toBe(300)
    ctx.dispose()
  })

  test("does not pause when content overflows after an upward wheel on short content", () => {
    let interactions = 0
    const ctx = setup({ interacted: () => interactions++, working: true })
    const event = new FakeWheelEvent(-20, ctx.el)

    ctx.el.fire("wheel", event as unknown as Event)
    ctx.el.scrollHeight = 300
    ctx.resize()

    expect(ctx.scroll.userScrolled()).toBe(false)
    expect(ctx.el.scrollTop).toBe(300)
    expect(interactions).toBe(0)
    ctx.dispose()
  })

  test("does not pause for an upward wheel at the top", () => {
    const ctx = setup()
    ctx.el.scrollHeight = 300
    const event = new FakeWheelEvent(-5, ctx.el)

    ctx.el.fire("wheel", event as unknown as Event)

    expect(ctx.scroll.userScrolled()).toBe(false)
    ctx.dispose()
  })

  test("does not reattach after an upward wheel within the bottom threshold", () => {
    const ctx = setup()
    ctx.el.scrollHeight = 300
    ctx.el.scrollTop = 195
    const event = new FakeWheelEvent(-5, ctx.el)

    ctx.el.fire("wheel", event as unknown as Event)
    ctx.scroll.handleScroll()

    expect(ctx.scroll.userScrolled()).toBe(true)
    expect(ctx.el.scrollTop).toBe(195)

    ctx.el.scrollTop = 200
    ctx.scroll.handleScroll()

    expect(ctx.scroll.userScrolled()).toBe(false)
    ctx.dispose()
  })

  test("follows when initially short content starts overflowing", () => {
    const ctx = setup()
    ctx.resize()

    expect(ctx.scroll.userScrolled()).toBe(false)

    ctx.el.scrollHeight = 300
    ctx.resize()

    expect(ctx.scroll.userScrolled()).toBe(false)
    expect(ctx.el.scrollTop).toBe(300)
    ctx.dispose()
  })
})
