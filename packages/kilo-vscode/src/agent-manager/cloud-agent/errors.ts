export class CloudAgentDisconnectedError extends Error {}

export class CloudAgentSignedOutError extends Error {}

export function isCloudAgentUnauthorized(err: unknown): boolean {
  return unauthorized(err, new Set())
}

function unauthorized(err: unknown, seen: Set<object>): boolean {
  if (typeof err === "string") return statusText(err)
  if (!(err instanceof Object) || seen.has(err)) return false
  seen.add(err)

  const obj = err as Record<string, unknown>
  if (obj.status === 401) return true
  if (obj.statusCode === 401) return true
  if (obj.response instanceof Object && "status" in obj.response && obj.response.status === 401) return true
  for (const key of ["_tag", "name", "message"] as const) {
    if (typeof obj[key] === "string" && statusText(obj[key])) return true
  }
  return unauthorized(obj.error, seen)
}

function statusText(value: string): boolean {
  return /\b401\b|unauthori[sz]ed/i.test(value)
}
