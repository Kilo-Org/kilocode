export type UpsellAction = "shown" | "opened" | "not_now" | "dont_show_again" | "undo"

export type UpsellState = {
  converted?: boolean
  opened?: boolean
  optedOut?: boolean
  snoozedAt?: number
  snoozeCount?: number
}

export function eligible(state: UpsellState, now: number) {
  return (
    !state.converted &&
    !state.opened &&
    !state.optedOut &&
    (state.snoozeCount ?? 0) < 3 &&
    (state.snoozedAt == null || now - state.snoozedAt >= 7 * 24 * 60 * 60 * 1000)
  )
}
