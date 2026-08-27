import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { createRoot } from "solid-js"

const observers: Array<() => void> = []

mock.module("@solid-primitives/resize-observer", () => ({
  createResizeObserver: (_source: () => HTMLElement | undefined, callback: () => void) => {
    observers.push(callback)
  },
}))

const originalElement = globalThis.Element
const originalNode = globalThis.Node
const originalWheelEvent = globalThis.WheelEvent
const originalMutationObserver = globalThis.MutationObserver

type Listener = {
  callback: (event: Event) => void
  capture: boolean
}

class FakeElement {
  scrollHeight = 100
  clientHeight = 100
  clientWidth = 100
  offsetWidth = 100
  scrollTop = 0
  style = { overflowAnchor: "" }
  hovered = false
  control = false
  dir = ""
  rect = { left: 0, top: 0, right: 100, bottom: 100 }
  ownerDocument!: FakeDocument
  private children = new Set<FakeElement>()
  private listeners = new Map<string, Listener[]>()

  closest(selector: string) {
    return this.control && selector === "button, input, textarea, select" ? this : null
  }

  contains(node: unknown): boolean {
    return node === this || (node instanceof FakeElement && [...this.children].some((child) => child.contains(node)))
  }

  append(child: FakeElement) {
    child.ownerDocument = this.ownerDocument
    this.children.add(child)
  }

  matches(selector: string) {
    return selector === ":hover" && this.hovered
  }

  getBoundingClientRect() {
    return this.rect
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

class FakeDocument extends FakeElement {
  body: FakeElement
  documentElement: FakeElement

  constructor() {
    super()
    this.ownerDocument = this
    this.body = new FakeElement()
    this.body.ownerDocument = this
    this.documentElement = new FakeElement()
    this.documentElement.ownerDocument = this
  }
}

class FakeWheelEvent {
  constructor(
    readonly deltaY: number,
    readonly target: FakeElement,
  ) {}
}

class FakeMouseEvent {
  constructor(
    readonly target: FakeElement,
    readonly clientX = 0,
    readonly clientY = 0,
  ) {}
}

class FakePointerEvent extends FakeMouseEvent {
  constructor(
    readonly pointerId: number,
    target: FakeElement,
    clientX = 0,
    clientY = 0,
  ) {
    super(target, clientX, clientY)
  }
}

class FakeTouchEvent extends FakeMouseEvent {}

class FakeKeyboardEvent {
  readonly defaultPrevented = false
  readonly shiftKey = false

  constructor(
    readonly key: string,
    readonly target: FakeElement,
  ) {}
}

const mutators: (() => void)[] = []

class FakeMutationObserver {
  constructor(readonly callback: () => void) {
    mutators.push(callback)
  }

  observe() {}

  disconnect() {
    const at = mutators.indexOf(this.callback)
    if (at >= 0) mutators.splice(at, 1)
  }
}

globalThis.Element = FakeElement as unknown as typeof Element
globalThis.Node = FakeElement as unknown as typeof Node
globalThis.WheelEvent = FakeWheelEvent as unknown as typeof WheelEvent
globalThis.MutationObserver = FakeMutationObserver as unknown as typeof MutationObserver

const { createAutoScroll } = await import("./create-auto-scroll")

function setup(options?: { doc?: FakeDocument; interacted?: () => void; working?: boolean }) {
  const doc = options?.doc ?? new FakeDocument()
  const el = new FakeElement()
  el.ownerDocument = doc
  const root = createRoot((dispose) => ({
    dispose,
    scroll: createAutoScroll({
      working: () => options?.working ?? false,
      onUserInteracted: options?.interacted,
    }),
  }))
  root.scroll.scrollRef(el as unknown as HTMLElement)
  root.scroll.contentRef(new FakeElement() as unknown as HTMLElement)

  const mutate = () => mutators.forEach((callback) => callback())

  const resize = (index?: number) => {
    if (index !== undefined) {
      observers[index]?.()
      return
    }
    observers.forEach((callback) => callback())
  }

  return { ...root, doc, el, resize, mutate }
}

function overflow(ctx: ReturnType<typeof setup>, height = 1000, top = 800) {
  ctx.el.scrollHeight = height
  ctx.el.clientHeight = 200
  ctx.el.scrollTop = top
}

function gutter(ctx: ReturnType<typeof setup>, dir = "") {
  ctx.el.clientWidth = 85
  ctx.el.offsetWidth = 100
  ctx.el.rect = { left: 0, top: 0, right: 100, bottom: 100 }
  ctx.el.dir = dir
}

beforeEach(() => {
  observers.length = 0
  mutators.length = 0
})

afterAll(() => {
  if (originalElement) globalThis.Element = originalElement
  else Reflect.deleteProperty(globalThis, "Element")
  if (originalNode) globalThis.Node = originalNode
  else Reflect.deleteProperty(globalThis, "Node")
  if (originalWheelEvent) globalThis.WheelEvent = originalWheelEvent
  else Reflect.deleteProperty(globalThis, "WheelEvent")
  if (originalMutationObserver) globalThis.MutationObserver = originalMutationObserver
  else Reflect.deleteProperty(globalThis, "MutationObserver")
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

  test.each([0, 0.5, 1])("preserves upward intent after a %spx scroll near the bottom", (offset) => {
    const ctx = setup({ working: true })
    overflow(ctx)
    let now = 10
    const clock = spyOn(performance, "now").mockImplementation(() => now)

    try {
      ctx.el.fire("wheel", new FakeWheelEvent(-1, ctx.el) as unknown as Event)
      ctx.el.scrollTop -= offset
      ctx.scroll.handleScroll()
      expect(ctx.scroll.userScrolled()).toBe(true)

      now = 500
      ctx.scroll.handleScroll()
      ctx.el.scrollHeight = 1100
      ctx.mutate()
      ctx.resize()

      expect(ctx.scroll.userScrolled()).toBe(true)
      expect(ctx.el.scrollTop).toBe(800 - offset)
    } finally {
      clock.mockRestore()
      ctx.dispose()
    }
  })

  test("pauses for upward wheel input over a transcript button", () => {
    const ctx = setup({ working: true })
    overflow(ctx)
    const button = new FakeElement()
    button.control = true
    ctx.el.append(button)

    ctx.el.fire("wheel", new FakeWheelEvent(-240, button) as unknown as Event)
    expect(ctx.scroll.userScrolled()).toBe(true)

    ctx.el.scrollTop = 560
    ctx.scroll.handleScroll()
    ctx.el.scrollHeight = 1100
    ctx.mutate()
    ctx.resize()

    expect(ctx.scroll.userScrolled()).toBe(true)
    expect(ctx.el.scrollTop).toBe(560)
    ctx.dispose()
  })

  test("does not treat button clicks and key presses as scroll input", () => {
    const ctx = setup({ working: true })
    overflow(ctx)
    const button = new FakeElement()
    button.control = true
    ctx.el.append(button)

    ctx.el.fire("pointerdown", new FakePointerEvent(1, button) as unknown as Event)
    ctx.doc.fire("keydown", new FakeKeyboardEvent("ArrowUp", button) as unknown as Event)
    ctx.el.scrollTop = 600
    ctx.scroll.handleScroll()

    expect(ctx.scroll.userScrolled()).toBe(false)
    expect(ctx.el.scrollTop).toBe(1000)
    ctx.dispose()
  })

  test("keeps a pause when a layout change puts the same position at the bottom", () => {
    const ctx = setup({ working: true })
    overflow(ctx, 1000, 400)
    ctx.scroll.pause()

    ctx.el.scrollHeight = 600
    ctx.scroll.handleScroll()
    ctx.el.scrollHeight = 1000
    ctx.mutate()
    ctx.resize()

    expect(ctx.scroll.userScrolled()).toBe(true)
    expect(ctx.el.scrollTop).toBe(400)
    ctx.dispose()
  })

  test.each(["wheel", "keyboard"])("preserves new %s input before a pending bottom scroll", (input) => {
    const ctx = setup({ working: true })
    overflow(ctx)
    let now = 10
    const clock = spyOn(performance, "now").mockImplementation(() => now)

    try {
      ctx.el.fire("wheel", new FakeWheelEvent(-20, ctx.el) as unknown as Event)
      ctx.el.scrollTop = 780
      ctx.scroll.handleScroll()
      expect(ctx.scroll.userScrolled()).toBe(true)

      ctx.el.scrollTop = 800
      if (input === "wheel") ctx.el.fire("wheel", new FakeWheelEvent(-20, ctx.el) as unknown as Event)
      if (input === "keyboard") {
        ctx.doc.fire("keydown", new FakeKeyboardEvent("ArrowUp", ctx.el) as unknown as Event)
      }
      ctx.scroll.handleScroll()
      expect(ctx.scroll.userScrolled()).toBe(true)

      ctx.el.scrollTop = 780
      ctx.scroll.handleScroll()
      now = 500
      ctx.el.scrollHeight = 1100
      ctx.mutate()
      ctx.resize()

      expect(ctx.scroll.userScrolled()).toBe(true)
      expect(ctx.el.scrollTop).toBe(780)
    } finally {
      clock.mockRestore()
      ctx.dispose()
    }
  })

  test("reattaches when a downward wheel returns to the bottom", () => {
    const ctx = setup({ working: true })
    overflow(ctx)
    ctx.el.fire("wheel", new FakeWheelEvent(-20, ctx.el) as unknown as Event)
    ctx.el.scrollTop = 780
    ctx.scroll.handleScroll()
    expect(ctx.scroll.userScrolled()).toBe(true)

    ctx.el.fire("wheel", new FakeWheelEvent(20, ctx.el) as unknown as Event)
    ctx.el.scrollTop = 800
    ctx.scroll.handleScroll()
    expect(ctx.scroll.userScrolled()).toBe(false)

    ctx.el.scrollHeight = 1100
    ctx.mutate()
    expect(ctx.el.scrollTop).toBe(1100)
    ctx.dispose()
  })

  test("continues following streaming growth after a downward wheel at the bottom", () => {
    const ctx = setup({ working: true })
    ctx.el.scrollHeight = 1000
    ctx.el.clientHeight = 200
    ctx.el.scrollTop = 800

    ctx.el.fire("wheel", new FakeWheelEvent(50, ctx.el) as unknown as Event)
    ctx.el.scrollHeight = 1048
    ctx.resize(0)

    expect(ctx.scroll.userScrolled()).toBe(false)
    expect(ctx.el.scrollTop).toBe(1048)
    ctx.dispose()
  })

  test("continues following when streaming reflow emits scroll before resize", () => {
    const ctx = setup({ working: true })
    ctx.el.scrollHeight = 1000
    ctx.el.clientHeight = 200
    ctx.el.scrollTop = 800

    ctx.el.scrollHeight = 1108
    ctx.scroll.handleScroll()

    expect(ctx.scroll.userScrolled()).toBe(false)

    ctx.resize(0)

    expect(ctx.scroll.userScrolled()).toBe(false)
    expect(ctx.el.scrollTop).toBe(1108)
    ctx.dispose()
  })

  test("continues following after a programmatic scroll correction", () => {
    const ctx = setup({ working: true })
    ctx.el.scrollHeight = 1000
    ctx.el.clientHeight = 200
    ctx.el.scrollTop = 800
    ctx.scroll.handleScroll()

    // A tool card that shrinks and recovers inside one frame makes the browser
    // clamp the pin away without changing the final content size, so no resize
    // entry follows and the pin has to be restored from the scroll event.
    ctx.el.scrollTop = 760
    ctx.scroll.handleScroll()

    expect(ctx.scroll.userScrolled()).toBe(false)
    expect(ctx.el.scrollTop).toBe(1000)
    ctx.dispose()
  })

  test("pins streamed content when it is added, before any resize entry", () => {
    const ctx = setup({ working: true })
    ctx.el.scrollHeight = 1000
    ctx.el.clientHeight = 200
    ctx.el.scrollTop = 800

    // The resize entry for this growth only arrives after the frame has laid out
    // and painted, so the mutation itself has to pin the view.
    ctx.el.scrollHeight = 1080
    ctx.mutate()

    expect(ctx.scroll.userScrolled()).toBe(false)
    expect(ctx.el.scrollTop).toBe(1080)
    ctx.dispose()
  })

  test("ignores content mutations while the user reads earlier output", () => {
    const ctx = setup({ working: true })
    ctx.el.scrollHeight = 1000
    ctx.el.clientHeight = 200
    ctx.el.scrollTop = 400
    ctx.scroll.pause()

    ctx.el.scrollHeight = 1080
    ctx.mutate()

    expect(ctx.el.scrollTop).toBe(400)
    ctx.dispose()
  })

  test("leaves an idle transcript where a layout clamp put it", () => {
    const ctx = setup()
    ctx.el.scrollHeight = 1000
    ctx.el.clientHeight = 200
    ctx.el.scrollTop = 800
    ctx.scroll.handleScroll()

    ctx.el.scrollTop = 704
    ctx.scroll.handleScroll()

    expect(ctx.scroll.userScrolled()).toBe(false)
    expect(ctx.el.scrollTop).toBe(704)
    ctx.dispose()
  })

  test("pauses for a body-targeted keyboard scroll over the transcript", () => {
    const ctx = setup({ working: true })
    ctx.el.scrollHeight = 1000
    ctx.el.clientHeight = 200
    ctx.el.scrollTop = 800
    ctx.el.hovered = true

    ctx.doc.fire("keydown", new FakeKeyboardEvent("PageUp", ctx.doc.body) as unknown as Event)
    ctx.el.scrollTop = 600
    ctx.scroll.handleScroll()

    expect(ctx.scroll.userScrolled()).toBe(true)

    ctx.el.scrollHeight = 1100
    ctx.resize(0)

    expect(ctx.el.scrollTop).toBe(600)
    ctx.dispose()
  })

  test("routes body-targeted keyboard scroll to the deepest hovered container", () => {
    const doc = new FakeDocument()
    const outer = setup({ doc, working: true })
    const inner = setup({ doc, working: true })
    outer.el.append(inner.el)
    outer.el.scrollHeight = 1000
    outer.el.clientHeight = 200
    outer.el.scrollTop = 800
    inner.el.scrollHeight = 500
    inner.el.clientHeight = 100
    inner.el.scrollTop = 400
    outer.el.hovered = true
    inner.el.hovered = true

    doc.fire("keydown", new FakeKeyboardEvent("PageUp", doc.body) as unknown as Event)
    inner.el.scrollTop = 300
    inner.scroll.handleScroll()

    expect(inner.scroll.userScrolled()).toBe(true)
    expect(outer.scroll.userScrolled()).toBe(false)
    inner.dispose()
    outer.dispose()
  })

  test("routes keyboard scroll past a nested container boundary", () => {
    const doc = new FakeDocument()
    const outer = setup({ doc, working: true })
    const inner = setup({ doc, working: true })
    outer.el.append(inner.el)
    outer.el.scrollHeight = 1000
    outer.el.clientHeight = 200
    outer.el.scrollTop = 800
    inner.el.scrollHeight = 500
    inner.el.clientHeight = 100
    inner.el.scrollTop = 0
    outer.el.hovered = true
    inner.el.hovered = true

    doc.fire("keydown", new FakeKeyboardEvent("PageUp", doc.body) as unknown as Event)
    outer.el.scrollTop = 700
    outer.scroll.handleScroll()

    expect(outer.scroll.userScrolled()).toBe(true)
    expect(inner.scroll.userScrolled()).toBe(false)
    inner.dispose()
    outer.dispose()
  })

  test("removes disposed containers from keyboard ownership", () => {
    const doc = new FakeDocument()
    const outer = setup({ doc, working: true })
    const inner = setup({ doc, working: true })
    outer.el.append(inner.el)
    outer.el.scrollHeight = 1000
    outer.el.clientHeight = 200
    outer.el.scrollTop = 800
    inner.el.scrollHeight = 500
    inner.el.clientHeight = 100
    inner.el.scrollTop = 400
    outer.el.hovered = true
    inner.el.hovered = true
    inner.dispose()

    doc.fire("keydown", new FakeKeyboardEvent("PageUp", doc.body) as unknown as Event)
    outer.el.scrollTop = 700
    outer.scroll.handleScroll()

    expect(outer.scroll.userScrolled()).toBe(true)
    outer.dispose()
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

  test("does not snap to bottom on content resize after user scrolls up while idle", () => {
    const ctx = setup({ working: false })
    ctx.el.scrollHeight = 1000
    ctx.el.clientHeight = 200
    ctx.el.scrollTop = 800 // at bottom

    // User wheels up
    const event = new FakeWheelEvent(-50, ctx.el)
    ctx.el.fire("wheel", event as unknown as Event)
    ctx.el.scrollTop = 750
    ctx.scroll.handleScroll()

    expect(ctx.scroll.userScrolled()).toBe(true)

    // Virtual list re-measures / resizes content
    ctx.el.scrollHeight = 1100
    ctx.resize()

    // Must NOT snap to bottom (1100), must remain at user scroll position (750)
    expect(ctx.scroll.userScrolled()).toBe(true)
    expect(ctx.el.scrollTop).toBe(750)
    ctx.dispose()
  })

  test("does not snap to bottom when dragging scrollbar up while idle", () => {
    const ctx = setup({ working: false })
    ctx.el.scrollHeight = 1000
    ctx.el.clientHeight = 200
    ctx.el.scrollTop = 800 // at bottom

    // User presses pointerdown on scrollbar and drags up
    ctx.el.fire("pointerdown", new Event("pointerdown"))
    ctx.el.scrollTop = 600
    ctx.scroll.handleScroll()

    expect(ctx.scroll.userScrolled()).toBe(true)

    // Content resize during drag
    ctx.el.scrollHeight = 1050
    ctx.resize()

    expect(ctx.scroll.userScrolled()).toBe(true)
    expect(ctx.el.scrollTop).toBe(600)
    ctx.dispose()
  })

  test("pauses after pointer input moves the scroll position", () => {
    const ctx = setup({ working: true })
    ctx.el.scrollHeight = 1000
    ctx.el.clientHeight = 200
    ctx.el.scrollTop = 800
    ctx.scroll.handleScroll()

    ctx.el.fire("pointerdown", new Event("pointerdown"))
    ctx.el.scrollTop = 600
    ctx.scroll.handleScroll()

    expect(ctx.scroll.userScrolled()).toBe(true)

    ctx.el.scrollHeight = 1050
    ctx.resize()

    expect(ctx.el.scrollTop).toBe(600)
    ctx.dispose()
  })

  test("pauses for a document-targeted mousedown in the scrollbar gutter", () => {
    const ctx = setup({ working: true })
    overflow(ctx)
    gutter(ctx)

    ctx.doc.fire("mousedown", new FakeMouseEvent(ctx.doc, 95, 50) as unknown as Event)
    ctx.el.scrollTop = 600
    ctx.scroll.handleScroll()

    expect(ctx.scroll.userScrolled()).toBe(true)
    expect(ctx.el.scrollTop).toBe(600)
    ctx.dispose()
  })

  test("tracks gestures on the live document when a detached transcript is adopted", () => {
    const detached = new FakeDocument()
    const live = new FakeDocument()
    const prior = Object.getOwnPropertyDescriptor(globalThis, "document")
    Object.defineProperty(globalThis, "document", { value: live, configurable: true })

    try {
      const ctx = setup({ doc: detached, working: true })
      overflow(ctx)
      gutter(ctx)
      ctx.el.ownerDocument = live

      live.fire("mousedown", new FakeMouseEvent(live, 95, 50) as unknown as Event)
      ctx.el.scrollTop = 600
      ctx.scroll.handleScroll()

      expect(ctx.scroll.userScrolled()).toBe(true)
      expect(ctx.el.scrollTop).toBe(600)
      ctx.dispose()
    } finally {
      if (prior) Object.defineProperty(globalThis, "document", prior)
      if (!prior) Reflect.deleteProperty(globalThis, "document")
    }
  })

  test("tracks document capture presses when the target receives no event", () => {
    const ctx = setup({ working: true })
    overflow(ctx)
    gutter(ctx)

    ctx.doc.fire("pointerdown", new FakePointerEvent(1, ctx.doc, 95, 50) as unknown as Event)
    ctx.doc.fire("mousedown", new FakeMouseEvent(ctx.doc, 95, 50) as unknown as Event)
    ctx.el.scrollTop = 600
    ctx.scroll.handleScroll()

    expect(ctx.scroll.userScrolled()).toBe(true)
    expect(ctx.el.scrollTop).toBe(600)
    ctx.dispose()
  })

  test("keeps a scrollbar gesture active after reaching the bottom", () => {
    const ctx = setup({ working: true })
    overflow(ctx)
    let now = 10
    const clock = spyOn(performance, "now").mockImplementation(() => now)

    try {
      ctx.doc.fire("pointerdown", new FakePointerEvent(1, ctx.el) as unknown as Event)
      ctx.el.scrollTop = 600
      ctx.scroll.handleScroll()
      expect(ctx.scroll.userScrolled()).toBe(true)

      ctx.el.scrollTop = 800
      ctx.scroll.handleScroll()
      expect(ctx.scroll.userScrolled()).toBe(false)

      now = 1000
      ctx.el.scrollTop = 600
      ctx.scroll.handleScroll()
      expect(ctx.scroll.userScrolled()).toBe(true)
      expect(ctx.el.scrollTop).toBe(600)
    } finally {
      clock.mockRestore()
      ctx.dispose()
    }
  })

  test("keeps a pointer gesture active beyond the grace period", () => {
    const ctx = setup({ working: true })
    overflow(ctx)
    let now = 10
    const clock = spyOn(performance, "now").mockImplementation(() => now)

    try {
      ctx.doc.fire("pointerdown", new FakePointerEvent(1, ctx.el) as unknown as Event)
      ctx.scroll.handleScroll()
      now = 1000
      ctx.doc.fire("pointermove", new FakePointerEvent(1, ctx.doc) as unknown as Event)
      ctx.el.scrollTop = 600
      ctx.scroll.handleScroll()

      expect(ctx.scroll.userScrolled()).toBe(true)
      expect(ctx.el.scrollTop).toBe(600)
    } finally {
      clock.mockRestore()
      ctx.dispose()
    }
  })

  test("keeps the release grace after a document mouse gesture", () => {
    const ctx = setup({ working: true })
    overflow(ctx)
    gutter(ctx)
    let now = 10
    const clock = spyOn(performance, "now").mockImplementation(() => now)

    try {
      ctx.doc.fire("mousedown", new FakeMouseEvent(ctx.doc, 95, 50) as unknown as Event)
      ctx.scroll.handleScroll()
      now = 100
      ctx.doc.fire("mouseup", new FakeMouseEvent(ctx.doc) as unknown as Event)
      now = 200
      ctx.el.scrollTop = 600
      ctx.scroll.handleScroll()

      expect(ctx.scroll.userScrolled()).toBe(true)
      expect(ctx.el.scrollTop).toBe(600)
    } finally {
      clock.mockRestore()
      ctx.dispose()
    }
  })

  test("does not mark an off-gutter document press", () => {
    const ctx = setup({ working: true })
    overflow(ctx)
    gutter(ctx)

    ctx.doc.fire("mousedown", new FakeMouseEvent(ctx.doc, 50, 50) as unknown as Event)
    ctx.el.scrollTop = 600
    ctx.scroll.handleScroll()

    expect(ctx.scroll.userScrolled()).toBe(false)
    expect(ctx.el.scrollTop).toBe(1000)
    ctx.dispose()
  })

  test("routes a nested document press to the deepest owner", () => {
    const doc = new FakeDocument()
    const outer = setup({ doc, working: true })
    const inner = setup({ doc, working: true })
    outer.el.append(inner.el)
    overflow(outer)
    overflow(inner, 500, 400)
    gutter(outer)
    inner.el.clientWidth = 65
    inner.el.offsetWidth = 80
    inner.el.rect = { left: 10, top: 10, right: 90, bottom: 90 }

    doc.fire("pointerdown", new FakePointerEvent(1, doc, 80, 50) as unknown as Event)
    inner.el.scrollTop = 200
    inner.scroll.handleScroll()

    expect(inner.scroll.userScrolled()).toBe(true)
    expect(outer.scroll.userScrolled()).toBe(false)
    outer.dispose()
    inner.dispose()
  })

  test("keeps touch activity alive through a late move", () => {
    const ctx = setup({ working: true })
    overflow(ctx)
    let now = 10
    const clock = spyOn(performance, "now").mockImplementation(() => now)

    try {
      ctx.doc.fire("touchstart", new FakeTouchEvent(ctx.el) as unknown as Event)
      ctx.scroll.handleScroll()
      now = 1000
      ctx.doc.fire("touchmove", new FakeTouchEvent(ctx.doc) as unknown as Event)
      ctx.el.scrollTop = 600
      ctx.scroll.handleScroll()

      expect(ctx.scroll.userScrolled()).toBe(true)
      expect(ctx.el.scrollTop).toBe(600)
    } finally {
      clock.mockRestore()
      ctx.dispose()
    }
  })

  test("resume clears an in-progress gesture before correcting the viewport", () => {
    const ctx = setup({ working: true })
    overflow(ctx)

    ctx.el.fire("pointerdown", new FakePointerEvent(1, ctx.el) as unknown as Event)
    ctx.scroll.resume()
    ctx.el.scrollTop = 600
    ctx.scroll.handleScroll()

    expect(ctx.scroll.userScrolled()).toBe(false)
    expect(ctx.el.scrollTop).toBe(1000)
    ctx.dispose()
  })
})
