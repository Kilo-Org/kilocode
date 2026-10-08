/**
 * Progressive fold for the prompt toolbar actions.
 *
 * The result depends on the toolbar width only. It never depends on the
 * agent, model, or reasoning labels, so a long model name truncates and does
 * not push actions into the overflow menu, and a pick never moves an icon.
 */

/** Space kept for the agent, model, and reasoning pill. */
export const FOLD_RESERVE = 210
/** One small icon button plus the gap after it. */
export const FOLD_SLOT = 26

/**
 * Returns how many foldable actions stay visible. Callers order the actions
 * from low to high priority and keep the last ones. When at least one action
 * folds, the overflow button takes one slot.
 */
export function fold(input: { width: number; pinned: number; count: number }) {
  const room = input.width - FOLD_RESERVE - input.pinned
  if (room >= input.count * FOLD_SLOT) return input.count
  return Math.max(0, Math.min(input.count, Math.floor((room - FOLD_SLOT) / FOLD_SLOT)))
}
