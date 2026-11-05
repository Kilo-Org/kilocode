export type UpsellAction = "shown" | "opened" | "not_now" | "dont_show_again" | "undo"

export type UpsellState = {
  converted?: boolean
  opened?: boolean
  optedOut?: boolean
  snoozedAt?: number
  snoozeCount?: number
}

export function apply(
  state: UpsellState,
  action: Exclude<UpsellAction, "shown"> | "observed",
  now: number,
): UpsellState {
  return {
    ...state,
    ...(action === "observed" ? { opened: true } : {}),
    ...(action === "opened" ? { converted: true } : {}),
    ...(action === "not_now" && (state.snoozeCount ?? 0) < 3
      ? { snoozedAt: Math.max(state.snoozedAt ?? now, now), snoozeCount: (state.snoozeCount ?? 0) + 1 }
      : {}),
    ...(action === "dont_show_again" ? { optedOut: true } : {}),
    ...(action === "undo" ? { optedOut: false } : {}),
  }
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
