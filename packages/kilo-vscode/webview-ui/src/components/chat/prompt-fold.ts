/**
 * Progressive fold for the prompt toolbar actions.
 *
 * The result depends on the toolbar width and font size only. It never
 * depends on the agent, model, or reasoning labels, so a long model name
 * truncates and does not push actions into the overflow menu, and a pick never
 * moves an icon.
 */

/** Space kept for the agent, model, and reasoning control, in toolbar ems (about 210px at 11px). */
const RESERVE_EM = 19

/** Space kept for the selector control. It scales with the toolbar font size. */
export function reserve(el: Element) {
  return RESERVE_EM * (parseFloat(getComputedStyle(el).fontSize) || 11)
}

/**
 * Returns how many foldable actions stay visible. Callers order the actions
 * from low to high priority and keep the last ones. When at least one action
 * folds, the overflow button takes one slot.
 *
 * `width` is the toolbar content width minus the gap between the selectors and
 * the actions, `pinned` is the width of the actions that never fold, and
 * `slot` is one action button plus the gap after it. At every fold step the
 * selector control gets exactly `reserve`.
 */
export function fold(input: { width: number; pinned: number; count: number; reserve: number; slot: number }) {
  const room = input.width - input.reserve - input.pinned
  if (room >= input.count * input.slot) return input.count
  return Math.max(0, Math.min(input.count, Math.floor((room - input.slot) / input.slot)))
}
