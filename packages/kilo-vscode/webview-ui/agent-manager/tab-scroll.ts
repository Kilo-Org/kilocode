import { createEffect, createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { SessionInfo } from "../src/types/messages"

/**
 * Keeps the Agent Manager tab strip usable when tabs overflow.
 *
 * - Converts vertical wheel movement over the tab strip into horizontal scroll.
 * - Tracks whether the left/right fade indicators should be visible.
 * - Scrolls the active tab into view after tab selection or tab list changes.
 */
export function useTabScroll(activeTabs: Accessor<SessionInfo[]>, activeId: Accessor<string | undefined>) {
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

  const wheel = (e: WheelEvent) => {
    const el = ref()
    if (!el) return
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    e.preventDefault()
    el.scrollLeft += e.deltaY > 0 ? 60 : -60
  }

  createEffect(() => {
    const el = ref()
    if (!el) return
    el.addEventListener("scroll", update, { passive: true })
    el.addEventListener("wheel", wheel, { passive: false })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true, subtree: true })
    onCleanup(() => {
      el.removeEventListener("scroll", update)
      el.removeEventListener("wheel", wheel)
      ro.disconnect()
      mo.disconnect()
    })
  })

  createEffect(() => {
    const id = activeId()
    const el = ref()
    activeTabs()
    if (!id || !el) return
    if (activeFrame !== undefined) cancelAnimationFrame(activeFrame)
    activeFrame = requestAnimationFrame(() => {
      activeFrame = undefined
      const tab = el.querySelector(`[data-tab-id="${id}"]`) as HTMLElement | null
      if (!tab) return
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
