import type { RemoteSessionID } from "./types"

/**
 * The explicit native allowlist both IDEs use. Everything here maps to a route
 * the Cloud facade already implements; nothing accepts a caller-supplied path,
 * URL, or method.
 */

/**
 * Cloud's public directory selector. The facade requires
 * `directory=/cloud-agent/sessions/<kiloSessionId>` for collection-scoped
 * routes and rejects extra selectors on id-scoped routes.
 */
export const PUBLIC_DIRECTORY_PREFIX = "/cloud-agent/sessions/"

export function publicDirectory(sessionID: string) {
  return `${PUBLIC_DIRECTORY_PREFIX}${encodeURIComponent(sessionID)}`
}

export type Route = {
  readonly kind: "route"
  readonly method: "GET" | "POST"
  readonly remote: `/${string}`
  readonly query: URLSearchParams
}

export type Result = Route | { readonly kind: "mismatch" } | undefined

const SELECTOR_QUERY = new Set(["directory", "workspace", "location[directory]", "location[workspace]"])
const TRANSCRIPT_QUERY = new Set(["limit", "before"])

const SESSION_ROUTES: ReadonlyArray<{
  readonly method: "GET" | "POST"
  readonly suffix: string
  readonly remote: (id: string) => `/${string}`
}> = [
  { method: "GET", suffix: "", remote: (id) => `/kilo/session/${id}` },
  { method: "GET", suffix: "/message", remote: (id) => `/kilo/session/${id}/message` },
  { method: "POST", suffix: "/prompt_async", remote: (id) => `/kilo/session/${id}/prompt_async` },
  { method: "POST", suffix: "/abort", remote: (id) => `/kilo/session/${id}/abort` },
  { method: "POST", suffix: "/command", remote: (id) => `/kilo/session/${id}/command` },
  { method: "GET", suffix: "/todo", remote: (id) => `/kilo/session/${id}/todo` },
  { method: "GET", suffix: "/diff", remote: (id) => `/kilo/session/${id}/diff` },
]

type Collection =
  | { readonly method: "GET"; readonly path: string; readonly remote: `/${string}` }
  | { readonly method: "POST"; readonly pattern: RegExp; readonly remote: (id: string) => `/${string}` }

const COLLECTION: ReadonlyArray<Collection> = [
  { method: "GET", path: "/session/status", remote: "/kilo/session/status" },
  { method: "GET", path: "/question", remote: "/kilo/question" },
  { method: "GET", path: "/permission", remote: "/kilo/permission" },
  { method: "GET", path: "/event", remote: "/kilo/event" },
  { method: "POST", pattern: /^\/question\/([^/]+)\/reply$/, remote: (id) => `/kilo/question/${id}/reply` },
  { method: "POST", pattern: /^\/question\/([^/]+)\/reject$/, remote: (id) => `/kilo/question/${id}/reject` },
  { method: "POST", pattern: /^\/permission\/([^/]+)\/reply$/, remote: (id) => `/kilo/permission/${id}/reply` },
]

function session(path: string) {
  const match = /^\/session\/([^/]+)(\/.*)?$/.exec(path)
  if (!match?.[1]) return undefined
  return { id: match[1], suffix: match[2] ?? "" }
}

function transcript(inbound: URLSearchParams) {
  const query = new URLSearchParams()
  for (const key of TRANSCRIPT_QUERY) {
    for (const value of inbound.getAll(key)) query.append(key, value)
  }
  return query
}

function forwarded(inbound: URLSearchParams) {
  const query = new URLSearchParams()
  for (const [key, value] of inbound) {
    if (SELECTOR_QUERY.has(key)) continue
    query.append(key, value)
  }
  return query
}

/**
 * Whether a local request belongs to the native allowlist at all. The routing
 * hook uses this to keep the allowlist ahead of local classification without
 * duplicating the table.
 */
export function isNativePath(method: string, path: string) {
  for (const rule of COLLECTION) {
    if (rule.method !== method) continue
    if ("path" in rule ? path === rule.path : rule.pattern.test(path)) return true
  }
  const parsed = session(path)
  if (!parsed) return false
  return SESSION_ROUTES.some((rule) => rule.method === method && rule.suffix === parsed.suffix)
}

/**
 * Classifies a local native request. A session id that disagrees with the
 * attachment is a mismatch, never a route: equal native ids in different
 * providers must not cross-route traffic.
 */
export function classify(id: RemoteSessionID, method: string, path: string, inbound: URLSearchParams): Result {
  for (const rule of COLLECTION) {
    if (rule.method !== method) continue
    if ("path" in rule) {
      if (path !== rule.path) continue
      return { kind: "route", method: rule.method, remote: rule.remote, query: selector(id, inbound) }
    }
    const match = rule.pattern.exec(path)
    if (!match?.[1]) continue
    return { kind: "route", method: rule.method, remote: rule.remote(match[1]), query: selector(id, inbound) }
  }

  const parsed = session(path)
  if (!parsed) return undefined
  let decoded = parsed.id
  try {
    decoded = decodeURIComponent(parsed.id)
  } catch {
    return undefined
  }
  if (decoded !== id) return { kind: "mismatch" }
  for (const rule of SESSION_ROUTES) {
    if (rule.method !== method || rule.suffix !== parsed.suffix) continue
    return {
      kind: "route",
      method: rule.method,
      remote: rule.remote(decoded),
      // Cloud rejects every id-scoped selector except the transcript pagination
      // keys. Its abort is session-scoped, so a local `scope=session` is not
      // forwarded.
      query: rule.suffix === "/message" ? transcript(inbound) : new URLSearchParams(),
    }
  }
  return undefined
}

function selector(id: RemoteSessionID, inbound: URLSearchParams) {
  const query = forwarded(inbound)
  query.set("directory", publicDirectory(id))
  return query
}
