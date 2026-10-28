import type { FailureCode, NativeRequest } from "@/kilocode/session-hosting/types"
import { isNativePath } from "@/kilocode/session-hosting/native-routes"
import { errorCode } from "@/kilocode/session-hosting/response"
import { readBoundedJson } from "@/kilocode/cloud/response-json"
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

class BodyError {
  readonly _tag = "BodyError"

  constructor(readonly kind: "too_large" | "invalid") {}
}

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
  readonly stream: HttpServerRequest.HttpServerRequest["stream"]
}

/** The attachment id carried in the existing workspace selector slot. */
export function attachmentID(url: URL, headers: Headers) {
  const candidates = [
    url.searchParams.get("workspace"),
    url.searchParams.get("location[workspace]"),
    headers["x-kilo-workspace"],
  ]
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
    (method === "GET" && path === "/session") ||
    (method === "POST" && path === "/session/viewed") ||
    path === "/experimental/workspace" ||
    path.startsWith("/experimental/workspace/") ||
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
      const attached = yield* entry.provider
        .attach({
          id: entry.session,
          ...(entry.organizationID ? { organizationID: entry.organizationID } : {}),
        })
        .pipe(
          Effect.catch((error) => {
            if (error.code === "not_found") invalidate(entry, store)
            return Effect.succeed(undefined)
          }),
        )
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
      ...(body.bytes ? { body: body.bytes } : {}),
      ...(plan.entry.organizationID ? { organizationID: plan.entry.organizationID } : {}),
    }
    return yield* route(native).pipe(
      Effect.flatMap((response) => {
        if (response.status !== 404) return forwardResponse(response)
        return Effect.tryPromise({
          try: () => readBoundedJson(response.clone(), MAX_BODY_BYTES),
          catch: () => undefined,
        }).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
          Effect.flatMap((body) => {
            if (errorCode(body) === "KILO_SESSION_NOT_FOUND") invalidate(plan.entry)
            return forwardResponse(response)
          }),
        )
      }),
      Effect.catch((error) => {
        if (error.code === "not_found") invalidate(plan.entry)
        return Effect.succeed(failure(error.code))
      }),
    )
  })
}

function invalidate(entry: Attachments.Entry, store: Attachments.Store = Attachments.store) {
  store.disposeSession(entry.session)
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
    if (request.method === "GET") return { kind: "ok" } as const
    const declared = Number(request.headers["content-length"] ?? "")
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { kind: "too_large" } as const
    return yield* request.stream.pipe(
      Stream.runFoldEffect(
        () => new Uint8Array(),
        (bytes, chunk) => {
          if (bytes.byteLength + chunk.byteLength > MAX_BODY_BYTES) {
            return Effect.fail(new BodyError("too_large"))
          }
          const next = new Uint8Array(bytes.byteLength + chunk.byteLength)
          next.set(bytes)
          next.set(chunk, bytes.byteLength)
          return Effect.succeed(next)
        },
      ),
      Effect.catch((error) => Effect.fail(error instanceof BodyError ? error : new BodyError("invalid"))),
      Effect.match({
        onFailure: (error) => ({ kind: error.kind }) as const,
        onSuccess: (bytes) => ({ kind: "ok", ...(bytes.byteLength > 0 ? { bytes } : {}) }) as const,
      }),
    )
  })
}

function forwardResponse(response: Response): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    const name = key.toLowerCase()
    if (name === "content-type" || STRIP_RESPONSE_HEADERS.has(name)) return
    headers[key] = value
  })
  const contentType = response.headers.get("content-type")
  const options = {
    status: response.status,
    headers,
    ...(contentType ? { contentType } : {}),
  }
  if (!response.body) return Effect.succeed(HttpServerResponse.raw(null, options))
  if (contentType?.startsWith("text/event-stream")) {
    return Effect.succeed(
      HttpServerResponse.stream(Stream.fromReadableStream({ evaluate: () => response.body!, onError: (err) => err }), {
        contentType: "text/event-stream",
        headers,
      }),
    )
  }
  // Native non-streaming routes are bounded JSON. Buffer them instead of
  // relaying a provider-owned stream across the server boundary.
  return Effect.tryPromise({
    try: () => response.arrayBuffer(),
    catch: () => new Error("Session host response could not be read"),
  }).pipe(
    Effect.map((buffer) => HttpServerResponse.raw(new TextDecoder().decode(buffer), options)),
    Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 502 }))),
  )
}

const STATUS: Record<Failure | FailureCode, number> = {
  unknown: 404,
  expired: 410,
  disposed: 410,
  unavailable: 503,
  too_large: 413,
  invalid_request: 400,
  auth_unavailable: 503,
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
  auth_unavailable: "Kilo Cloud credentials could not be read",
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
