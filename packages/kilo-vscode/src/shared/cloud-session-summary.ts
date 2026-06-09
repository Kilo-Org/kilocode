export type CloudSessionSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export type CloudSummarySource = "list" | "detail" | "event"

export type CloudSummaryVersion = {
  value: CloudSessionSummary
  source: CloudSummarySource
}

type WebviewSession = {
  id: string
  title?: string
  createdAt: string
  updatedAt: string
}

type SdkSession = {
  id: string
  title: string
  time: { created: number; updated: number }
}

const rank: Record<CloudSummarySource, number> = { list: 0, detail: 1, event: 2 }

export function toCloudSummary(session: WebviewSession | SdkSession): CloudSessionSummary {
  if ("time" in session) {
    return {
      id: session.id,
      title: session.title,
      createdAt: new Date(session.time.created).toISOString(),
      updatedAt: new Date(session.time.updated).toISOString(),
    }
  }
  return {
    id: session.id,
    title: session.title ?? "",
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

export function pickCloudSummary(current: CloudSummaryVersion, next: CloudSummaryVersion): CloudSummaryVersion {
  if (next.value.updatedAt > current.value.updatedAt) return next
  if (next.value.updatedAt < current.value.updatedAt) return current
  if (rank[next.source] > rank[current.source]) return next
  if (rank[next.source] < rank[current.source]) return current
  return equal(current.value, next.value) ? current : next
}

export function replaceCloudSummary(sessions: CloudSessionSummary[], next: CloudSessionSummary): CloudSessionSummary[] {
  const index = sessions.findIndex((session) => session.id === next.id)
  if (index < 0 || equal(sessions[index], next)) return sessions
  return sessions.map((session, current) => (current === index ? next : session))
}

export function mergeCloudSummaries(
  sessions: CloudSessionSummary[],
  observed: ReadonlyMap<string, CloudSummaryVersion>,
): CloudSummaryVersion[] {
  return sessions.map((session) => {
    const listed: CloudSummaryVersion = { value: session, source: "list" }
    const current = observed.get(session.id)
    return current ? pickCloudSummary(current, listed) : listed
  })
}

export function equalCloudSummary(a: CloudSessionSummary, b: CloudSessionSummary): boolean {
  return equal(a, b)
}

function equal(a: CloudSessionSummary, b: CloudSessionSummary): boolean {
  return a.id === b.id && a.title === b.title && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt
}
