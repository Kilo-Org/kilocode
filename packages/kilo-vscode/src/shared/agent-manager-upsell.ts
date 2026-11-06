export type UpsellAction = "shown" | "opened" | "not_now" | "dont_show_again" | "undo"

export type UpsellState = {
  converted?: boolean
  opened?: boolean
  optedOut?: boolean
  snoozedAt?: number
  snoozeCount?: number
}

export function apply(state: UpsellState, action: Exclude<UpsellAction, "shown">, now: number): UpsellState {
  switch (action) {
    case "opened":
      return { ...state, converted: true }
    case "not_now":
      if ((state.snoozeCount ?? 0) >= 3) return state
      return {
        ...state,
        snoozedAt: Math.max(state.snoozedAt ?? now, now),
        snoozeCount: (state.snoozeCount ?? 0) + 1,
      }
    case "dont_show_again":
      return { ...state, optedOut: true }
    case "undo":
      return { ...state, optedOut: false }
  }
  return state
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
