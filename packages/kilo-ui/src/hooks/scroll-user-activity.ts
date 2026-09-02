interface UserActivityOptions {
  grace: number
  onUp: () => void
}

type Kind = "pointer" | "mouse" | "touch"
type Gesture = { kind: Kind; id?: number }

const SCROLL_KEYS = new Set(["ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "])
const owners = new WeakMap<Document, Set<HTMLElement>>()
const gestures = new WeakMap<Document, HTMLElement>()

const isPotentialScrollInput = (event: Event) => {
  if (!(event.target instanceof Element)) return true
  const editable = event.target.closest<HTMLElement>("[contenteditable]")
  return !event.target.closest("button, input, textarea, select") && !editable?.isContentEditable
}

const deepest = (items: HTMLElement[]) => items.find((el) => !items.some((item) => item !== el && el.contains(item)))

const gutter = (el: HTMLElement, event: Event) => {
  const width = el.offsetWidth - el.clientWidth
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(el.offsetWidth) || el.offsetWidth <= 0) return false

  const rect = el.getBoundingClientRect()
  const x = (event as MouseEvent).clientX
  const y = (event as MouseEvent).clientY
  const span = rect.right - rect.left
  if (!Number.isFinite(x) || !Number.isFinite(y) || span <= 0) return false
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false

  const size = (width * span) / el.offsetWidth
  const left = el.dir === "rtl" || el.ownerDocument.defaultView?.getComputedStyle(el).direction === "rtl"
  return left ? x <= rect.left + size : x >= rect.right - size
}

const resolve = (event: Event, doc: Document) => {
  const items = [...(owners.get(doc) ?? [])]
  const target = event.target
  if (target !== doc && target instanceof Element && target !== doc.body && target !== doc.documentElement) {
    return deepest(items.filter((el) => el.contains(target)))
  }
  return deepest(items.filter((el) => gutter(el, event)))
}

export const createUserActivity = (options: UserActivityOptions) => {
  let marked = false
  let time = 0
  let scroll: HTMLElement | undefined
  let doc: Document | undefined
  let gesture: Gesture | undefined

  const mark = (event?: Event) => {
    if (event && !isPotentialScrollInput(event)) return
    if (!scroll || scroll.scrollHeight - scroll.clientHeight <= 1) return
    marked = true
    time = performance.now()
  }

  const start = (event: Event, kind: Kind, local = false) => {
    if (!scroll || !doc || !isPotentialScrollInput(event)) return
    if (scroll.scrollHeight - scroll.clientHeight <= 1) return
    if ("button" in event && event.button !== 0) return
    if (!local && resolve(event, doc) !== scroll) return

    const owner = gestures.get(doc)
    if (owner && owner !== scroll) return

    if (gesture) {
      if (kind === "touch" && gesture.kind === "pointer") gesture = { kind }
      mark()
      return
    }

    gesture = { kind, id: kind === "pointer" ? (event as PointerEvent).pointerId : undefined }
    gestures.set(doc, scroll)
    mark()
  }

  const match = (event: Event, kind: Kind) => {
    if (!gesture || gesture.kind !== kind) return false
    return kind !== "pointer" || gesture.id === (event as PointerEvent).pointerId
  }

  const move = (event: Event, kind: Kind) => {
    if (!doc || !scroll || gestures.get(doc) !== scroll || !match(event, kind)) return
    mark()
  }

  const end = (event: Event, kind: Kind) => {
    if (!doc || !scroll || gestures.get(doc) !== scroll || !match(event, kind)) return
    mark()
    gesture = undefined
    gestures.delete(doc)
  }

  const clear = () => {
    marked = false
    time = 0
  }

  const reset = () => {
    if (doc && scroll && gestures.get(doc) === scroll) gestures.delete(doc)
    clear()
    gesture = undefined
  }

  const wheel = (event: WheelEvent) => {
    if (!scroll || scroll.scrollHeight - scroll.clientHeight <= 1) return
    if (event.deltaY >= 0 || scroll.scrollTop <= 0) return
    mark()
    options.onUp()
  }

  const key = (event: KeyboardEvent) => {
    if (!scroll || event.defaultPrevented || !SCROLL_KEYS.has(event.key) || !isPotentialScrollInput(event)) return
    const target = event.target
    const root =
      target === scroll.ownerDocument ||
      target === scroll.ownerDocument.body ||
      target === scroll.ownerDocument.documentElement
    const up =
      event.key === "ArrowUp" || event.key === "Home" || event.key === "PageUp" || (event.key === " " && event.shiftKey)
    const matches = [...(owners.get(scroll.ownerDocument) ?? [])].filter((el) => {
      const owns = root ? el.matches(":hover") : target instanceof Node && el.contains(target)
      if (!owns) return false
      return up ? el.scrollTop > 1 : el.scrollHeight - el.clientHeight - el.scrollTop > 1
    })
    if (deepest(matches) !== scroll) return
    mark(event)
    if (up) options.onUp()
  }

  return {
    listen: (el: HTMLElement) => {
      scroll = el
      doc = el.isConnected || typeof document === "undefined" ? el.ownerDocument : document
      const root = doc
      const registered = owners.get(root) ?? new Set<HTMLElement>()
      registered.add(el)
      owners.set(root, registered)

      const down = [
        ["pointerdown", (event: Event) => start(event, "pointer", true)],
        ["mousedown", (event: Event) => start(event, "mouse", true)],
        ["touchstart", (event: Event) => start(event, "touch", true)],
      ] as const
      const handlers = [
        ["pointerdown", (event: Event) => start(event, "pointer")],
        ["mousedown", (event: Event) => start(event, "mouse")],
        ["touchstart", (event: Event) => start(event, "touch")],
        ["pointermove", (event: Event) => move(event, "pointer")],
        ["mousemove", (event: Event) => move(event, "mouse")],
        ["touchmove", (event: Event) => move(event, "touch")],
        ["pointerup", (event: Event) => end(event, "pointer")],
        ["mouseup", (event: Event) => end(event, "mouse")],
        ["touchend", (event: Event) => end(event, "touch")],
        ["pointercancel", (event: Event) => end(event, "pointer")],
        ["touchcancel", (event: Event) => end(event, "touch")],
      ] as const
      const opts = { capture: true, passive: true }

      for (const [type, handler] of handlers) root.addEventListener(type, handler, opts)
      for (const [type, handler] of down) el.addEventListener(type, handler, opts)
      el.addEventListener("wheel", wheel, opts)
      root.addEventListener("keydown", key, { passive: true })

      return () => {
        reset()
        registered.delete(el)
        if (registered.size === 0) owners.delete(root)
        for (const [type, handler] of handlers) root.removeEventListener(type, handler, opts)
        for (const [type, handler] of down) el.removeEventListener(type, handler, opts)
        el.removeEventListener("wheel", wheel, opts)
        root.removeEventListener("keydown", key)
        if (scroll === el) scroll = undefined
        if (doc === root) doc = undefined
      }
    },
    consumeScroll: () => {
      const value = marked
      marked = false
      return value
    },
    isRecent: () => gesture !== undefined || (time > 0 && performance.now() - time < options.grace),
    clear,
    reset,
  }
}
