import { createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { canScroll, distanceFromBottom } from "./auto-scroll"
import { createUserActivity } from "./scroll-user-activity"

const DEBOUNCE_MS = 100
// Grace window after a real pointer/key/touch interaction during which a
// ResizeObserver or non-user scroll event must not snap the view back to the
// bottom. Upward wheel intent pauses immediately in its capture handler.
const USER_INTERACTION_GRACE_MS = 300

export interface AutoScrollOptions {
  working: () => boolean
  onUserInteracted?: () => void
  bottomThreshold?: number
}

export function createAutoScroll(options: AutoScrollOptions) {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let scroll: HTMLElement | undefined
  let settling = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let stopTimer: ReturnType<typeof setTimeout> | undefined
  let cleanup: (() => void) | undefined

  const [store, setStore] = createStore({
    contentRef: undefined as HTMLElement | undefined,
    scrollRef: undefined as HTMLElement | undefined,
    userScrolled: false,
  })

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const threshold = () => options.bottomThreshold ?? 10
  const active = () => options.working() || settling

  const bottom = () => {
    if (!scroll) return
    // `scrollTop` assignment bypasses any CSS `scroll-behavior: smooth`.
    scroll.scrollTop = scroll.scrollHeight
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const follow = () => {
    if (!active() || store.userScrolled) return
    if (!scroll || distanceFromBottom(scroll) < 2) return

    // For auto-following content we prefer immediate updates to avoid
    // visible "catch up" animations while content is still settling.
    bottom()
  }

  const force = () => {
    if (!scroll) return
    if (store.userScrolled) setStore("userScrolled", false)
    if (distanceFromBottom(scroll) < 2) return
    bottom()
  }

  const resume = () => {
    if (store.userScrolled) setStore("userScrolled", false)
    force()
  }

  const pause = () => {
    if (!scroll || store.userScrolled) return
    setStore("userScrolled", true)
    options.onUserInteracted?.()
  }

  const stop = () => {
    if (!scroll || !canScroll(scroll)) return
    pause()
  }

  // ---------------------------------------------------------------------------
  // User activity
  // ---------------------------------------------------------------------------

  const userActivity = createUserActivity({
    grace: USER_INTERACTION_GRACE_MS,
    // Upward wheel input anywhere in the transcript expresses the user's
    // intent to review earlier content, even when a nested region consumes it.
    onWheelUp: stop,
  })

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleScroll = () => {
    if (!scroll) return

    const input = userActivity.consumeScroll()
    const distance = distanceFromBottom(scroll)

    if (!canScroll(scroll)) return

    if (distance < threshold()) {
      if (store.userScrolled) setStore("userScrolled", false)
      return
    }

    if (!store.userScrolled && !input) {
      // Only explicit user input can pause following. Treat unclassified
      // scroll events from virtualization or layout changes as programmatic.
      if (userActivity.isRecent()) {
        stop()
      } else {
        bottom()
      }
      return
    }

    // Debounce to avoid layout-induced scroll shifts (e.g. images loading,
    // virtual-list reflows) from incorrectly breaking auto-follow.
    if (stopTimer) clearTimeout(stopTimer)
    stopTimer = setTimeout(() => {
      stopTimer = undefined
      if (!scroll) return
      if (distanceFromBottom(scroll) < threshold()) return
      stop()
    }, DEBOUNCE_MS)
  }

  const onContentResize = () => {
    if (scroll && !canScroll(scroll)) return
    if (!active()) {
      if (!store.userScrolled && scroll && distanceFromBottom(scroll) > threshold()) {
        bottom()
        return
      }
      return
    }
    if (store.userScrolled) {
      return
    }
    // Virtualized lists (virtua) re-measure items during user scroll, firing
    // resize events that race ahead of handleScroll's DEBOUNCE_MS window.
    // If the user just interacted with the scroller and is no longer near
    // the bottom, treat the resize as a layout reflow on top of their
    // scroll — pause auto-follow instead of snapping back to the bottom.
    if (scroll && userActivity.isRecent() && distanceFromBottom(scroll) > threshold()) {
      stop()
      return
    }
    // ResizeObserver fires after layout, before paint.
    // Keep the bottom locked in the same frame to avoid visible
    // "jump up then catch up" artifacts while streaming content.
    follow()
  }

  const onViewportResize = () => {
    if (!scroll) return
    if (!canScroll(scroll)) return
    if (store.userScrolled || userActivity.isRecent()) return
    bottom()
  }

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  createResizeObserver(() => store.contentRef, onContentResize)
  createResizeObserver(() => store.scrollRef, onViewportResize)

  createEffect(
    on(options.working, (working: boolean) => {
      settling = false
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = undefined

      if (working) {
        force()
        return
      }

      settling = true
      settleTimer = setTimeout(() => {
        settling = false
      }, 300)
    }),
  )

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  const setScroll = (el: HTMLElement | undefined) => {
    if (cleanup) {
      cleanup()
      cleanup = undefined
    }

    scroll = el
    setStore("scrollRef", el)

    if (!el) return

    el.style.overflowAnchor = "auto"
    cleanup = userActivity.listen(el)
  }

  onCleanup(() => {
    if (settleTimer) clearTimeout(settleTimer)
    if (stopTimer) clearTimeout(stopTimer)
    if (cleanup) cleanup()
  })

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    scrollRef: setScroll,
    contentRef: (el: HTMLElement | undefined) => setStore("contentRef", el),
    handleScroll,
    pause,
    resume,
    scrollToBottom: follow,
    forceScrollToBottom: force,
    userScrolled: () => store.userScrolled,
  }
}
