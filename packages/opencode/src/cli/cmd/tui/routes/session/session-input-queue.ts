// kilocode_change - new file

type SessionRef = {
  id: string
  parentID?: string | null
}

type QueueMap<T> = Record<string, readonly T[] | undefined>

export function sessionInputQueue<T>(
  current: SessionRef | undefined,
  children: readonly Pick<SessionRef, "id">[],
  bySession: QueueMap<T>,
): T[] {
  if (current?.parentID) return [...(bySession[current.id] ?? [])]
  return children.flatMap((session) => [...(bySession[session.id] ?? [])])
}
