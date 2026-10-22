/** Space kept for the agent, model, and reasoning control, in toolbar ems (about 210px at 11px). */
const RESERVE_EM = 19

/** Space kept for the selector control. It scales with the toolbar font size. */
export function reserve(el: Element) {
  return RESERVE_EM * (parseFloat(getComputedStyle(el).fontSize) || 11)
}
