import { createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { canScroll, distanceFromBottom } from "./auto-scroll"
import { createUserActivity } from "./scroll-user-activity"

// Grace window after a real pointer/key/touch interaction during which a
// ResizeObserver or non-user scroll event must not snap the view back to the
// bottom. Upward wheel intent pauses immediately in its capture handler.
const USER_INTERACTION_GRACE_MS = 300

export interface AutoScrollOptions {
  working: () => boolean
  onUserInteracted?: () => void
  bottomThreshold?: number
  overflowAnchor?: "none" | "auto" | "dynamic"
}

export function createAutoScroll(options: AutoScrollOptions) {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let scroll: HTMLElement | undefined
  let settling = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined
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
      if (store.userScrolled && (distance < 2 || !userActivity.isRecent())) setStore("userScrolled", false)
      return
    }

    // Virtualizer and layout corrections can move the viewport without
    // changing content height. Only an input event should pause auto-follow.
    if (!store.userScrolled && !input && !userActivity.isRecent()) return

    stop()
  }

  const onContentResize = () => {
    if (!scroll || !canScroll(scroll)) return
    if (store.userScrolled) return

    if (userActivity.isRecent() && distanceFromBottom(scroll) > threshold()) {
      stop()
      return
    }

    if (!active()) {
      if (!userActivity.isRecent() && distanceFromBottom(scroll) > threshold()) {
        bottom()
      }
      return
    }

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
    on(
      () => store.userScrolled,
      () => {
        if (scroll) updateOverflowAnchor(scroll)
      },
    ),
  )

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

  const updateOverflowAnchor = (el: HTMLElement) => {
    const mode = options.overflowAnchor ?? "none"
    if (mode === "none") {
      el.style.overflowAnchor = "none"
      return
    }
    if (mode === "auto") {
      el.style.overflowAnchor = "auto"
      return
    }
    el.style.overflowAnchor = store.userScrolled ? "auto" : "none"
  }

  const setScroll = (el: HTMLElement | undefined) => {
    if (cleanup) {
      cleanup()
      cleanup = undefined
    }

    scroll = el
    setStore("scrollRef", el)

    if (!el) return

    updateOverflowAnchor(el)
    cleanup = userActivity.listen(el)
  }

  onCleanup(() => {
    if (settleTimer) clearTimeout(settleTimer)
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
