import type { FailureCode, NativeRequest } from "@/kilocode/session-hosting/types"
import { isNativePath } from "@/kilocode/session-hosting/native-routes"
import { isLocalWorkspaceRoute } from "@/server/shared/workspace-routing"
import { Effect, Stream } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import * as Attachments from "../hosted-attachments"
/**
 * Local attachment routing. Opaque attachments take precedence over Workspace
 * lookup and over local/forward classification; hosting control routes stay
 * local, and an attachment that cannot be resolved never falls back to local
 * execution.
 */

export const MAX_BODY_BYTES = 256 * 1024

const FORWARD_HEADERS = ["accept", "content-type", "last-event-id"] as const

const STRIP_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
  "set-cookie",
])

const CLOUD_DIRECTORY = /^\/cloud-agent\/sessions\/[^/]+$/

export type Failure = "unknown" | "expired" | "disposed" | "unavailable" | "too_large" | "invalid_request"

export type Plan =
  | { readonly type: "local"; readonly directory: string }
  | { readonly type: "route"; readonly entry: Attachments.Entry }
  | { readonly type: "fail"; readonly reason: Failure }

export type Routed = Extract<Plan, { type: "route" | "fail" }>

type Headers = Record<string, string | undefined>

interface ServerRequest {
  readonly method: string
  readonly url: string
  readonly headers: Headers
  readonly text: HttpServerRequest.HttpServerRequest["text"]
}

/** The attachment id carried in the existing workspace selector slot. */
export function attachmentID(url: URL, headers: Headers) {
  const candidates = [url.searchParams.get("workspace"), url.searchParams.get("location[workspace]"), headers["x-kilo-workspace"]]
  for (const value of candidates) {
    if (value && Attachments.isID(value)) return value
  }
  return undefined
}

/**
 * The native allowlist always wins over local classification. Everything else
 * that the shared router already treats as local stays local, so a client that
 * configures an attachment selector globally keeps its sidebar and Kilo routes
 * working. Hosting control routes are local by construction.
 */
export function isLocalRoute(method: string, path: string) {
  if (isNativePath(method, path)) return false
  return (
    isLocalWorkspaceRoute(method, path) ||
    path === "/console" ||
    path.startsWith("/console/") ||
    path === "/kilocode/session-host" ||
    path.startsWith("/kilocode/session-host/")
  )
}

/**
 * The attachment selector wins over any directory hint. A Cloud public
 * selector would otherwise be created as a local project directory.
 */
export function localDirectory(url: URL, headers: Headers) {
  const raw = url.searchParams.get("directory") || headers["x-kilo-directory"]
  if (!raw) return process.cwd()
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }
  return CLOUD_DIRECTORY.test(decoded) ? process.cwd() : decoded
}

export function resolve(
  request: ServerRequest,
  url: URL,
  store: Attachments.Store = Attachments.store,
): Effect.Effect<Plan | undefined> {
  return Effect.gen(function* () {
    const id = attachmentID(url, request.headers)
    if (id === undefined) return undefined
    if (isLocalRoute(request.method, url.pathname)) {
      return { type: "local", directory: localDirectory(url, request.headers) } satisfies Plan
    }
    const found = store.lookup(id)
    if (found.kind !== "found") return { type: "fail", reason: found.kind } satisfies Plan
    const entry = found.entry
    if (entry.expiresAt <= Date.now()) {
      const attached = yield* entry.provider.attach({
        id: entry.session,
        ...(entry.organizationID ? { organizationID: entry.organizationID } : {}),
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!attached) return { type: "fail", reason: "unavailable" } satisfies Plan
      store.renew(entry, { expiresAt: attached.expiresAt })
    } else {
      store.renew(entry, { expiresAt: entry.expiresAt })
    }
    return { type: "route", entry } satisfies Plan
  })
}

export function respond(plan: Routed, request: ServerRequest): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  if (plan.type === "fail") return Effect.succeed(failure(plan.reason))
  const route = plan.entry.provider.route
  if (!route) return Effect.succeed(failure("unavailable"))

  return Effect.gen(function* () {
    const body = yield* payload(request)
    if (body.kind !== "ok") return failure(body.kind === "too_large" ? "too_large" : "invalid_request")
    const url = new URL(request.url, "http://localhost")
    const native: NativeRequest = {
      session: plan.entry.session,
      method: request.method,
      path: url.pathname,
      query: url.searchParams,
      headers: forward(request.headers),
      ...(body.text ? { body: body.text } : {}),
      ...(plan.entry.organizationID ? { organizationID: plan.entry.organizationID } : {}),
    }
    return yield* route(native).pipe(
      Effect.map(forwardResponse),
      Effect.catch((error) => Effect.succeed(failure(error.code))),
    )
  })
}

function forward(headers: Headers) {
  const out = new Headers()
  for (const name of FORWARD_HEADERS) {
    const value = headers[name]
    if (typeof value === "string" && value.length > 0) out.set(name, value)
  }
  return out
}

function payload(request: ServerRequest) {
  return Effect.gen(function* () {
    const declared = Number(request.headers["content-length"] ?? "")
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { kind: "too_large" } as const
    const text = yield* request.text.pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (text === undefined) return { kind: "invalid" } as const
    if (text.length === 0) return { kind: "ok" } as const
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { kind: "too_large" } as const
    return { kind: "ok", text } as const
  })
}

function forwardResponse(response: Response): HttpServerResponse.HttpServerResponse {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    const name = key.toLowerCase()
    if (name === "content-type" || STRIP_RESPONSE_HEADERS.has(name)) return
    headers[key] = value
  })
  const contentType = response.headers.get("content-type")
  if (!response.body) {
    return HttpServerResponse.raw(null, { status: response.status, headers })
  }
  return HttpServerResponse.stream(
    Stream.fromReadableStream({ evaluate: () => response.body!, onError: (err) => err }),
    { status: response.status, headers, ...(contentType ? { contentType } : {}) },
  )
}

const STATUS: Record<Failure | FailureCode, number> = {
  unknown: 404,
  expired: 410,
  disposed: 410,
  unavailable: 503,
  too_large: 413,
  invalid_request: 400,
  signed_out: 401,
  unauthorized: 502,
  payment_required: 402,
  not_found: 404,
  invalid_response: 502,
  rejected: 409,
  unknown_provider: 503,
}

const MESSAGE: Record<Failure | FailureCode, string> = {
  unknown: "Session attachment was not found",
  expired: "Session attachment has expired",
  disposed: "Session attachment was disposed",
  unavailable: "Hosted session is unavailable",
  too_large: "Native request body is too large",
  invalid_request: "Native request is not supported for this attachment",
  signed_out: "Kilo Cloud credentials are unavailable",
  unauthorized: "Hosted session rejected these credentials",
  payment_required: "Hosted session requires additional balance",
  not_found: "Hosted session was not found",
  invalid_response: "Hosted session returned an invalid response",
  rejected: "Hosted session rejected this request",
  unknown_provider: "Session host provider is not registered",
}

function failure(reason: Failure | FailureCode) {
  return HttpServerResponse.jsonUnsafe(
    { error: "KILO_SESSION_ATTACHMENT", code: reason, message: MESSAGE[reason] },
    { status: STATUS[reason] },
  )
}

export const HostedRouting = {
  attachmentID,
  isLocalRoute,
  localDirectory,
  resolve,
  respond,
}
