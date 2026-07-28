import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"

/**
 * Keeps tab strips usable when tabs overflow.
 *
 * - Converts vertical wheel movement over the tab strip into horizontal scroll.
 * - Tracks whether the left/right fade indicators should be visible.
 * - Scrolls the active tab into view after tab selection or tab list changes.
 */
export function useTabScroll<T>(items: Accessor<readonly T[]>, active: Accessor<string | undefined>) {
  const [ref, setRef] = createSignal<HTMLDivElement | undefined>()
  const [showLeft, setShowLeft] = createSignal(false)
  const [showRight, setShowRight] = createSignal(false)
  let scrollFrame: number | undefined
  let activeFrame: number | undefined

  const update = () => {
    if (scrollFrame !== undefined) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined
      const el = ref()
      if (!el) return
      setShowLeft(el.scrollLeft > 2)
      setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
    })
  }

  const wheel = (event: WheelEvent) => {
    const el = ref()
    if (!el) return
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.preventDefault()
    el.scrollLeft += event.deltaY > 0 ? 60 : -60
  }

  createEffect(() => {
    const el = ref()
    if (!el) return
    el.addEventListener("scroll", update, { passive: true })
    el.addEventListener("wheel", wheel, { passive: false })
    const resize = new ResizeObserver(update)
    resize.observe(el)
    const mutation = new MutationObserver(update)
    mutation.observe(el, { childList: true, subtree: true })
    onCleanup(() => {
      el.removeEventListener("scroll", update)
      el.removeEventListener("wheel", wheel)
      resize.disconnect()
      mutation.disconnect()
    })
  })

  createEffect(() => {
    const id = active()
    const el = ref()
    items()
    if (!id || !el) return
    if (activeFrame !== undefined) cancelAnimationFrame(activeFrame)
    activeFrame = requestAnimationFrame(() => {
      activeFrame = undefined
      const tab = el.querySelector(`[data-tab-id="${id}"]`)
      if (!(tab instanceof HTMLElement)) return
      const left = tab.offsetLeft
      const right = left + tab.offsetWidth
      if (left < el.scrollLeft) {
        el.scrollTo({ left: left - 8, behavior: "smooth" })
        return
      }
      if (right > el.scrollLeft + el.clientWidth) {
        el.scrollTo({ left: right - el.clientWidth + 8, behavior: "smooth" })
      }
    })
  })

  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
    if (activeFrame !== undefined) cancelAnimationFrame(activeFrame)
  })

  return { setRef, showLeft, showRight }
}
