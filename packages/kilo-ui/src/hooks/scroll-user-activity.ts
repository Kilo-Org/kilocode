interface UserActivityOptions {
  grace: number
  onWheelUp: () => void
}

const SCROLL_KEYS = new Set(["ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "])
const owners = new WeakMap<Document, Set<HTMLElement>>()

const isPotentialScrollInput = (event: Event) => {
  if (!(event.target instanceof Element)) return true
  const editable = event.target.closest<HTMLElement>("[contenteditable]")
  return !event.target.closest("button, input, textarea, select") && !editable?.isContentEditable
}

export const createUserActivity = (options: UserActivityOptions) => {
  let marked = false
  let time = 0
  let scroll: HTMLElement | undefined

  // Mark input that may cause the next scroll so layout-driven scroll events
  // do not get mistaken for the user leaving auto-follow mode.
  const mark = (event: Event) => {
    if (!isPotentialScrollInput(event)) return
    if (scroll && scroll.scrollHeight - scroll.clientHeight <= 1) return
    marked = true
    time = performance.now()
  }

  const handleWheel = (event: WheelEvent) => {
    if (!isPotentialScrollInput(event)) return
    if (!scroll || scroll.scrollHeight - scroll.clientHeight <= 1) return
    if (event.deltaY >= 0 || scroll.scrollTop <= 0) return
    mark(event)
    options.onWheelUp()
  }

  const handleKey = (event: KeyboardEvent) => {
    if (!scroll || event.defaultPrevented || !SCROLL_KEYS.has(event.key)) return
    const target = event.target
    const root = target === scroll.ownerDocument.body || target === scroll.ownerDocument.documentElement
    const up = event.key === "ArrowUp" || event.key === "Home" || event.key === "PageUp" || (event.key === " " && event.shiftKey)
    const matches = [...(owners.get(scroll.ownerDocument) ?? [])].filter((el) => {
      const owns = root ? el.matches(":hover") : target instanceof Node && el.contains(target)
      if (!owns) return false
      return up ? el.scrollTop > 1 : el.scrollHeight - el.clientHeight - el.scrollTop > 1
    })
    const owner = matches.find((el) => !matches.some((candidate) => candidate !== el && el.contains(candidate)))
    if (owner !== scroll) return
    mark(event)
  }

  return {
    listen: (el: HTMLElement) => {
      scroll = el
      const registered = owners.get(el.ownerDocument) ?? new Set<HTMLElement>()
      registered.add(el)
      owners.set(el.ownerDocument, registered)
      el.addEventListener("wheel", handleWheel, { passive: true, capture: true })
      el.addEventListener("pointerdown", mark, { passive: true })
      el.addEventListener("touchstart", mark, { passive: true })
      el.ownerDocument.addEventListener("keydown", handleKey, { passive: true })

      return () => {
        if (scroll === el) scroll = undefined
        registered.delete(el)
        if (registered.size === 0) owners.delete(el.ownerDocument)
        el.removeEventListener("wheel", handleWheel, { capture: true })
        el.removeEventListener("pointerdown", mark)
        el.removeEventListener("touchstart", mark)
        el.ownerDocument.removeEventListener("keydown", handleKey)
      }
    },
    consumeScroll: () => {
      const value = marked
      marked = false
      return value
    },
    isRecent: () => time > 0 && performance.now() - time < options.grace,
  }
}
