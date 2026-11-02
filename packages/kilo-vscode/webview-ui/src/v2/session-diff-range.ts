// The whole-session range for `session.diff`. The oldest and the newest user message come from one-item server
// queries, so the range covers the session instead of the page the client cache holds. A single user message is one
// turn, and `session.diff` only needs `to` to extend past it.
export type UserMessagePage = { data: readonly { id: string }[] }

export function sessionDiffRange(oldest: UserMessagePage, newest: UserMessagePage) {
  const from = oldest.data[0]?.id
  if (from === undefined) return {}
  const last = newest.data[0]?.id
  return { from, to: last === from ? undefined : last }
}
