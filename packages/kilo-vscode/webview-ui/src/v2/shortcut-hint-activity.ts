import type { Accessor } from "solid-js"
import { createSettledValue } from "./settled-value"

const HINT_GRACE_MS = 180

/** Coalesce brief agent status changes without delaying focus, typing or the actual send actions. */
export function createHintActivity(running: Accessor<boolean>, waiting: Accessor<number | undefined>) {
  const busy = createSettledValue(running, () => HINT_GRACE_MS, running())
  const settledWaiting = createSettledValue(waiting, () => (waiting() === undefined ? 0 : HINT_GRACE_MS), undefined)
  return {
    busy,
    // Stop suggesting a jump as soon as the session no longer needs an answer, or the target changed.
    waiting: () => (waiting() === settledWaiting() ? settledWaiting() : undefined),
  }
}
