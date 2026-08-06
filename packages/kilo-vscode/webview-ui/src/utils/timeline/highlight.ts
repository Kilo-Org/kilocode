/**
 * Cross-component signal correlating a hovered/selected task-timeline bar with
 * the chat part it represents. TaskTimeline dispatches on hover/keyboard-nav
 * change (no direct props/context link to the transcript, same convention as
 * the `scrollToMessage` and `resumeAutoScroll` window events); AssistantMessage
 * listens and highlights the matching part using the bar's own color, so users
 * can visually follow which bar belongs to which tool call — mirroring the
 * legacy extension's task-timeline row gutter highlight.
 */

export interface TimelineHighlight {
  msgId: string
  partId: string
}

export function same(a: TimelineHighlight | undefined, b: TimelineHighlight | undefined) {
  return a?.msgId === b?.msgId && a?.partId === b?.partId
}

const EVENT = "timelineHighlight"

export function dispatchTimelineHighlight(value: TimelineHighlight | undefined) {
  window.dispatchEvent(new CustomEvent<TimelineHighlight | undefined>(EVENT, { detail: value }))
}

/** Registers a listener and returns an unregister function for onCleanup. */
export function onTimelineHighlight(handler: (value: TimelineHighlight | undefined) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<TimelineHighlight | undefined>).detail)
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
