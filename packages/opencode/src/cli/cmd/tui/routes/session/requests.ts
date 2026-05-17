// kilocode_change start - keep blocking requests visible when focused on a child session
export function requestsForSession<T extends { sessionID: string }>(
  session: { id: string; parentID?: string } | undefined,
  children: readonly { id: string }[],
  requests: Record<string, T[] | undefined>,
) {
  if (!session) return []
  if (session.parentID) return requests[session.id] ?? []
  return children.flatMap((child) => requests[child.id] ?? [])
}
// kilocode_change end
