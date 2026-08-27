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
  let top = 0
  let settling = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let cleanup: (() => void) | undefined
  let watcher: MutationObserver | undefined

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
    userActivity.reset()
    if (store.userScrolled) setStore("userScrolled", false)
    force()
  }

  const pause = () => {
    if (!scroll) return
    top = scroll.scrollTop
    if (store.userScrolled) return
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
    onUp: stop,
  })

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleScroll = () => {
    if (!scroll) return

    const position = scroll.scrollTop
    const down = position > top
    top = position
    const input = userActivity.consumeScroll()
    const distance = distanceFromBottom(scroll)

    if (!canScroll(scroll)) return

    if (distance < threshold()) {
      if (store.userScrolled && down && (distance < 2 || !userActivity.isRecent())) {
        userActivity.clear()
        setStore("userScrolled", false)
      }
      return
    }

    // Virtualizer and layout corrections can move the viewport without
    // changing content height. Only an input event should pause auto-follow.
    if (!store.userScrolled && !input && !userActivity.isRecent()) {
      // A tool card that swaps views shrinks the transcript and recovers inside
      // the same frame. The shrink makes the browser clamp the pin away, and
      // because the final content size is unchanged no resize entry follows, so
      // the correction has to happen here or the transcript stays parked below
      // its bottom until the next content update.
      if (active()) bottom()
      return
    }

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

  // Content mutations are pinned while they are still queued, before the frame
  // lays out and paints. A ResizeObserver entry arrives after that layout, so
  // waiting for it lets the browser paint one frame with the new content hanging
  // below the viewport, which reads as the transcript twitching as it streams.
  const onContentMutate = () => {
    if (!scroll) return
    if (store.userScrolled || userActivity.isRecent()) return
    if (!canScroll(scroll)) return

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
        follow()
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

  const setContent = (el: HTMLElement | undefined) => {
    watcher?.disconnect()
    watcher = undefined

    setStore("contentRef", el)

    if (!el || typeof MutationObserver !== "function") return

    watcher = new MutationObserver(onContentMutate)
    watcher.observe(el, { childList: true, subtree: true, characterData: true })
  }

  const setScroll = (el: HTMLElement | undefined) => {
    if (cleanup) {
      cleanup()
      cleanup = undefined
    }

    scroll = el
    top = el?.scrollTop ?? 0
    setStore("scrollRef", el)

    if (!el) return

    updateOverflowAnchor(el)
    cleanup = userActivity.listen(el)
  }

  onCleanup(() => {
    if (settleTimer) clearTimeout(settleTimer)
    watcher?.disconnect()
    watcher = undefined
    if (cleanup) cleanup()
  })

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    scrollRef: setScroll,
    contentRef: setContent,
    handleScroll,
    pause,
    resume,
    scrollToBottom: follow,
    forceScrollToBottom: force,
    userScrolled: () => store.userScrolled,
  }
}
