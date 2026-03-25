import { createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"

const DEBOUNCE_MS = 100

export interface AutoScrollOptions {
  working: () => boolean
  onUserInteracted?: () => void
  bottomThreshold?: number
}

export function createAutoScroll(options: AutoScrollOptions) {
  let scroll: HTMLElement | undefined
  let settling = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let stopTimer: ReturnType<typeof setTimeout> | undefined
  let cleanup: (() => void) | undefined
  let userInitiated = false
  let lastScrollTop: number | undefined

  const threshold = () => options.bottomThreshold ?? 10

  const [store, setStore] = createStore({
    contentRef: undefined as HTMLElement | undefined,
    userScrolled: false,
  })

  const active = () => options.working() || settling

  const distanceFromBottom = (el: HTMLElement) => {
    return el.scrollHeight - el.clientHeight - el.scrollTop
  }

  const canScroll = (el: HTMLElement) => {
    return el.scrollHeight - el.clientHeight > 1
  }

  const markUser = (e: Event) => {
    if (e instanceof WheelEvent) {
      const target = e.target instanceof Element ? e.target : undefined
      const nested = target?.closest("[data-scrollable]")
      if (scroll && nested && nested !== scroll) return
    }
    userInitiated = true
  }

  const scrollToBottomNow = (behavior: ScrollBehavior) => {
    const el = scroll
    if (!el) return
    if (behavior === "smooth") {
      el.scrollTo({ top: el.scrollHeight, behavior })
      return
    }

    // `scrollTop` assignment bypasses any CSS `scroll-behavior: smooth`.
    el.scrollTop = el.scrollHeight
    lastScrollTop = el.scrollTop
  }

  const scrollToBottom = (force: boolean) => {
    if (!force && !active()) return
    const el = scroll
    if (!el) return

    if (!force && store.userScrolled) return
    if (force && store.userScrolled) setStore("userScrolled", false)

    const distance = distanceFromBottom(el)
    if (distance < 2) return

    // For auto-following content we prefer immediate updates to avoid
    // visible "catch up" animations while content is still settling.
    scrollToBottomNow("auto")
  }

  const stop = () => {
    const el = scroll
    if (!el) return
    if (!canScroll(el)) {
      if (store.userScrolled) setStore("userScrolled", false)
      return
    }
    if (store.userScrolled) return

    setStore("userScrolled", true)
    options.onUserInteracted?.()
  }

  const handleWheel = (e: WheelEvent) => {
    if (e.deltaY >= 0) return
    // If the user is scrolling within a nested scrollable region (tool output,
    // code block, etc), don't treat it as leaving the "follow bottom" mode.
    // Those regions opt in via `data-scrollable`.
    const el = scroll
    const target = e.target instanceof Element ? e.target : undefined
    const nested = target?.closest("[data-scrollable]")
    if (el && nested && nested !== el) return
    stop()
  }

  const handleScroll = () => {
    const el = scroll
    if (!el) return

    const byUser = userInitiated
    userInitiated = false
    const distance = distanceFromBottom(el)

    if (!canScroll(el)) {
      if (store.userScrolled) setStore("userScrolled", false)
      return
    }

    if (distance < threshold()) {
      if (store.userScrolled) setStore("userScrolled", false)
      lastScrollTop = el.scrollTop
      return
    }

    if (!store.userScrolled && !byUser) {
      if (el.scrollTop < (lastScrollTop ?? el.scrollTop)) {
        stop()
      } else {
        scrollToBottomNow("auto")
      }
      lastScrollTop = el.scrollTop
      return
    }

    // Debounce to avoid layout-induced scroll shifts (e.g. images loading,
    // virtual-list reflows) from incorrectly breaking auto-follow.
    if (stopTimer) clearTimeout(stopTimer)
    stopTimer = setTimeout(() => {
      stopTimer = undefined
      const cur = scroll
      if (!cur) return
      if (distanceFromBottom(cur) < threshold()) return
      stop()
    }, DEBOUNCE_MS)
  }

  const handleInteraction = () => {
    if (!active()) return
    stop()
  }

  createResizeObserver(
    () => store.contentRef,
    () => {
      const el = scroll
      if (el && !canScroll(el)) {
        if (store.userScrolled) setStore("userScrolled", false)
        return
      }
      if (!active()) {
        if (!store.userScrolled && el && distanceFromBottom(el) > threshold()) {
          scrollToBottomNow("auto")
          return
        }
        return
      }
      if (store.userScrolled) {
        return
      }
      // ResizeObserver fires after layout, before paint.
      // Keep the bottom locked in the same frame to avoid visible
      // "jump up then catch up" artifacts while streaming content.
      scrollToBottom(false)
    },
  )

  createEffect(
    on(options.working, (working: boolean) => {
      settling = false
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = undefined

      if (working) {
        scrollToBottom(true)
        return
      }

      settling = true
      settleTimer = setTimeout(() => {
        settling = false
      }, 300)
    }),
  )

  onCleanup(() => {
    if (settleTimer) clearTimeout(settleTimer)
    if (stopTimer) clearTimeout(stopTimer)
    if (cleanup) cleanup()
  })

  return {
    scrollRef: (el: HTMLElement | undefined) => {
      if (cleanup) {
        cleanup()
        cleanup = undefined
      }

      scroll = el

      if (!el) return

      el.style.overflowAnchor = "auto"
      el.addEventListener("wheel", handleWheel, { passive: true })
      el.addEventListener("wheel", markUser, { passive: true, capture: true })
      el.addEventListener("pointerdown", markUser, { passive: true })
      el.addEventListener("keydown", markUser, { passive: true })
      el.addEventListener("touchstart", markUser, { passive: true })

      cleanup = () => {
        el.removeEventListener("wheel", handleWheel)
        el.removeEventListener("wheel", markUser, { capture: true })
        el.removeEventListener("pointerdown", markUser)
        el.removeEventListener("keydown", markUser)
        el.removeEventListener("touchstart", markUser)
      }
    },
    contentRef: (el: HTMLElement | undefined) => setStore("contentRef", el),
    handleScroll,
    handleInteraction,
    pause: stop,
    resume: () => {
      if (store.userScrolled) setStore("userScrolled", false)
      scrollToBottom(true)
    },
    scrollToBottom: () => scrollToBottom(false),
    forceScrollToBottom: () => scrollToBottom(true),
    userScrolled: () => store.userScrolled,
  }
}
