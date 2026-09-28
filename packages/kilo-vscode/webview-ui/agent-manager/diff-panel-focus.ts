import {
  FOCUS_REGION_ATTRIBUTE,
  isPromptPaste,
  isReachablePrompt,
  ownsFocusRegion,
  isTextControl,
  isFocusRegion,
  releaseFocusRegion,
} from "../src/utils/focus"
import { DIFF_PANEL_SCROLLER, REVIEW_SCROLLER, diffToggleIntent, focusDiffScroller } from "./diff-focus"

/** Diff surfaces whose chrome must not arm or confirm worktree deletion. */
const DIFF_DELETE_GUARD = `[${FOCUS_REGION_ATTRIBUTE}], .am-diff-panel, .am-review-layout`

/** Whether a delete key target sits inside a diff surface. */
const isDiffFocusTarget = (target: EventTarget | null): boolean => {
  const el = target as Element | null
  return !!el && typeof el.closest === "function" && el.closest(DIFF_DELETE_GUARD) !== null
}

/** Diff panel focus lifecycle for the Changes toggle and its viewport. */
export function createDiffPanelFocus(opts: {
  isOpen: () => boolean
  open: (focus: boolean) => void
  close: () => void
  closeHistory: () => void
  focusPrompt: () => void
  revealPrompt?: () => void
  track: (action: string) => void
  schedule?: (run: () => void) => void
  frame?: (run: () => void) => void
  doc?: Document
}) {
  const schedule = opts.schedule ?? ((run: () => void) => queueMicrotask(run))
  const frame = opts.frame ?? ((run: () => void) => requestAnimationFrame(run))
  const doc = () => opts.doc ?? document
  let opener: HTMLElement | undefined
  let focusToken = 0

  const canFocus = (el: HTMLElement) => {
    if (!el.isConnected) return false
    if (el.closest("[inert]")) return false
    const style = doc().defaultView?.getComputedStyle(el)
    return !style || (style.display !== "none" && style.visibility !== "hidden")
  }

  const remember = () => {
    const active = doc().activeElement
    if (!active || active === doc().body) return
    // Keep the existing external opener when focus moves between diff modes.
    if (ownsFocusRegion(active)) return
    opener = active as HTMLElement
  }

  const restore = () => {
    const target = opener
    opener = undefined
    focusToken++
    schedule(() => {
      if (target && canFocus(target)) {
        target.focus({ preventScroll: true })
        if (doc().activeElement === target) return
      }
      opts.focusPrompt()
    })
  }

  const focusSoon = (selector: string) => {
    const token = ++focusToken
    const active = doc().activeElement
    const attempt = (retries: number) => {
      if (token !== focusToken || doc().activeElement !== active) return
      if (focusDiffScroller(selector, doc())) return
      if (retries > 0) frame(() => attempt(retries - 1))
    }
    frame(() => attempt(1))
  }

  const openPanel = (focus: boolean) => {
    remember()
    opts.open(focus)
    if (focus) focusSoon(DIFF_PANEL_SCROLLER)
  }

  const closePanel = () => {
    focusToken++
    opts.close()
    opts.closeHistory()
    restore()
  }

  /** Cmd/Ctrl+D: focus the open viewport, or close it when it already owns focus. */
  const toggleCommand = () => {
    const active = doc().activeElement
    if (active && ownsFocusRegion(active) && isTextControl(active)) return
    const intent = diffToggleIntent(opts.isOpen(), isFocusRegion(active))
    if (intent === "close") closePanel()
    else if (intent === "focus") {
      remember()
      focusSoon(DIFF_PANEL_SCROLLER)
    } else openPanel(true)
  }

  const toggleToolbar = () => {
    const open = opts.isOpen()
    opts.track(open ? "close" : "open")
    if (open) closePanel()
    else openPanel(false)
  }

  const release = (event: PointerEvent) => {
    focusToken++
    releaseFocusRegion(event, doc())
  }
  const paste = (event: ClipboardEvent) => {
    if (!isPromptPaste(event)) return
    const prompt = doc().querySelector<HTMLTextAreaElement>(
      ".am-chat-wrapper:not(.am-chat-wrapper-hidden) textarea.prompt-input",
    )
    if (!isReachablePrompt(prompt ?? undefined)) return
    focusToken++
    opts.closeHistory()
    opts.revealPrompt?.()
  }

  return {
    openPanel,
    closePanel,
    toggleCommand,
    toggleToolbar,
    focusReview: () => focusSoon(REVIEW_SCROLLER),
    isFocusTarget: isDiffFocusTarget,
    listen: () => {
      const target = doc().defaultView!
      target.addEventListener("pointerdown", release, true)
      target.addEventListener("paste", paste, true)
      return () => {
        target.removeEventListener("pointerdown", release, true)
        target.removeEventListener("paste", paste, true)
      }
    },
  }
}

/**
 * Wire the focus controller to the Agent Manager shell. Grouping the callbacks
 * here keeps the component call site short and the file within its line cap.
 */
export function createAppDiffPanelFocus(deps: {
  isOpen: () => boolean
  isReviewActive: () => boolean
  openSide: () => void
  closeSide: () => void
  closeHistory: () => void
  closeReview: (focus: boolean) => void
  focusPrompt: () => void
  hideReview: () => void
  clearTerminal: () => void
  track: (action: string) => void
}) {
  return createDiffPanelFocus({
    isOpen: deps.isOpen,
    open: (focus) => {
      deps.openSide()
      deps.closeHistory()
      if (deps.isReviewActive()) deps.closeReview(!focus)
    },
    close: deps.closeSide,
    closeHistory: deps.closeHistory,
    focusPrompt: deps.focusPrompt,
    revealPrompt: () => {
      deps.hideReview()
      deps.clearTerminal()
    },
    track: deps.track,
  })
}
