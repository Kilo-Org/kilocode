/*
 * Placement maths for the economics info popover.
 *
 * The popover is a plain in-DOM sibling of its icon rather than a portaled
 * floating-ui tooltip, so nothing flips or shifts it when it would leave the
 * scrolling panel: the first hero row sits right under the header, and the
 * leftmost card is narrower than the popover itself.
 */

/**
 * Opens above the icon when the popover fits, otherwise below. `top` is the
 * icon's viewport top, `height` the popover's measured height, `limit` the edge
 * it must not cross, and `gap` mirrors the CSS offset between the two.
 */
export function infoSide(top: number, height: number, limit: number, gap = 6) {
  return top - height - gap < limit ? "bottom" : "top"
}

/**
 * Anchors the popover to the icon's right edge unless it would then overflow
 * `limit`, the left edge of the visible area, in which case it is anchored to
 * the left instead. `right` is the icon's viewport right, `width` the popover's
 * measured width, and `gap` mirrors the CSS overhang past the icon.
 */
export function infoAlign(right: number, width: number, limit: number, gap = 4) {
  return right + gap - width < limit ? "start" : "end"
}
