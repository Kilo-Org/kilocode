// The decision that keeps the Kilo profile in step with the server account. It is pure, so the timing-sensitive
// cases the Profile view depends on are tested without a server or a webview.
export type AccountAction = "none" | "hold" | "refresh" | "clear"

/**
 * The action for the shown profile after a `provider.updated`: `none` keeps it, `hold` keeps an account through a
 * signed-out reading until the next event, `refresh` reloads it, and `clear` drops it.
 *
 * The Gateway publishes this event before it reloads, when its account is empty, so a signed-out reading can also come
 * from a team switch, a token refresh, or a retry. `held` is true after an earlier event held an account through such a
 * reading, which makes the next one a real sign-out.
 */
export function accountAction(
  shown: { profile: { organizationID: string | null } } | null | undefined,
  current: { authenticated: boolean; organizationID: string | null } | undefined,
  held: boolean,
): AccountAction {
  if (shown === undefined) return "none"
  if (current?.authenticated)
    return shown && shown.profile.organizationID === current.organizationID ? "none" : "refresh"
  if (shown === null) return "none"
  return held ? "clear" : "hold"
}
