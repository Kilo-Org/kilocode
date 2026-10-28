import { createHash } from "node:crypto"
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { Effect, Schema } from "effect"

export const limits = {
  changes: 64,
  batch: 512 * 1024,
  inline: 64 * 1024,
  blob: 8 * 1024 * 1024,
  session: 256 * 1024 * 1024,
}
export const Kind = Schema.Literals([
  "session",
  "message",
  "inbox",
  "instruction-entry",
  "instruction-state",
  "instruction-blob",
  "asset",
])
export type Kind = typeof Kind.Type
export const Tenant = Schema.Struct({ type: Schema.Literals(["user", "organization"]), id: Schema.String })
export type Tenant = typeof Tenant.Type
export const Grant = Schema.Struct({
  version: Schema.Literal(1),
  token: Schema.String,
  expiresAt: Schema.String,
  tenant: Tenant,
  userID: Schema.String,
})
export type Grant = typeof Grant.Type
export const Receipt = Schema.Struct({
  version: Schema.Literal(1),
  sessionID: Schema.String,
  batchID: Schema.String,
  after: Schema.Number,
  through: Schema.Number,
  revision: Schema.Number,
  changes: Schema.Number,
  digest: Schema.String,
  committedAt: Schema.Number,
})
export type Receipt = typeof Receipt.Type
export const State = Schema.Union([
  Schema.Struct({ version: Schema.Literal(1), sessionID: Schema.String, deleted: Schema.Literal(true) }),
  Schema.Struct({
    version: Schema.Literal(1),
    sessionID: Schema.String,
    deleted: Schema.Literal(false),
    tenant: Tenant,
    creatorID: Schema.String,
    sourceID: Schema.String,
    position: Schema.Number,
    lastReceipt: Schema.NullOr(Receipt),
  }),
])
export type State = typeof State.Type
export type BlobRef = { hash: string; bytes: number }
export type Change =
  | { op: "put"; kind: Kind; id: string; value: Schema.Json }
  | { op: "put"; kind: Kind; id: string; blob: BlobRef }
  | {
      op: "remove"
      kind: Exclude<Kind, "session">
      id: string
      cause: "revert" | "cancel" | "instruction-removed" | "consumed"
    }

export class Failure extends Schema.TaggedError<Failure>()("SessionSyncFailure", {
  code: Schema.String,
  message: Schema.String,
  retryable: Schema.Boolean,
  retryAt: Schema.optional(Schema.Number),
}) {}

export const fail = (code: string, message: string, retryable = false, retryAt?: number) =>
  new Failure({ code, message, retryable, ...(retryAt === undefined ? {} : { retryAt }) })
export const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex")
export const json = Schema.decodeUnknownSync(Schema.Json)
export const parse = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))
export const sameTenant = (a: Tenant, b: Tenant) => a.type === b.type && a.id === b.id
export const loopback = (hostname: string) =>
  hostname === "localhost" ||
  hostname === "[::1]" ||
  hostname === "::1" ||
  (isIP(hostname) === 4 && hostname.startsWith("127."))

export const destination = Effect.fn("SessionSync.destination")(function* (input: string, local: boolean) {
  const url = yield* Effect.try({
    try: () => new URL(input),
    catch: () => fail("invalid_destination", "A valid sync service URL is required"),
  })
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== ""))
    return yield* fail(
      "invalid_destination",
      "The sync URL must be an origin without credentials, path, query, or fragment",
    )
  if (url.protocol !== "https:" && !(local && url.protocol === "http:" && loopback(url.hostname)))
    return yield* fail("invalid_destination", "Use HTTPS, or explicit --local with an HTTP loopback address")
  if (url.protocol === "http:" && url.hostname === "localhost") {
    const addresses = yield* Effect.tryPromise({
      try: () => lookup(url.hostname, { all: true }),
      catch: () => fail("invalid_destination", "Cannot resolve the local sync service"),
    })
    if (!addresses.length || addresses.some((entry) => !loopback(entry.address)))
      return yield* fail("invalid_destination", "The local sync service must resolve only to loopback addresses")
  }
  return url.origin
})

const ErrorBody = Schema.Struct({
  error: Schema.Struct({ code: Schema.String, retryAt: Schema.optional(Schema.Number) }),
})
const decodeError = Schema.decodeUnknownOption(ErrorBody)

// Neither personal credentials nor short-lived grants may cross a redirect. Service error bodies are
// untrusted and can contain secrets; return a fixed message and a bounded machine-readable code instead.
const errorCodes: Record<string, true> = {
  invalid_request: true,
  blob_hash_mismatch: true,
  creator_mismatch: true,
  not_found: true,
  session_not_found: true,
  blob_not_found: true,
  source_conflict: true,
  batch_conflict: true,
  batch_superseded: true,
  position_conflict: true,
  blob_missing: true,
  revision_changed: true,
  upload_timeout: true,
  upload_in_progress: true,
  session_deleted: true,
  length_required: true,
  request_too_large: true,
  storage_budget_exceeded: true,
  internal_error: true,
  invalid_credential: true,
  unsupported_credential: true,
  auth_unavailable: true,
  account_blocked: true,
  organization_access_denied: true,
  unauthenticated: true,
  invalid_grant: true,
  method_not_allowed: true,
}

export const request = Effect.fn("SessionSync.request")(function* (
  url: string,
  token: string,
  method = "GET",
  body?: string | Uint8Array<ArrayBuffer>,
) {
  const bytes = body === undefined ? 0 : typeof body === "string" ? Buffer.byteLength(body) : body.byteLength
  // Allow 32 KiB/s plus handshake time, bounded by the service's five-minute blob lease.
  const timeout = Math.min(300_000, 30_000 + Math.ceil(bytes / (32 * 1024)) * 1000)
  const response = yield* Effect.tryPromise({
    try: async (signal) => {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      const response = await fetch(url, {
        method,
        redirect: "error",
        signal: deadline,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined
            ? {}
            : {
                "content-type": typeof body === "string" ? "application/json" : "application/octet-stream",
                "content-length": String(bytes),
              }),
        },
        body,
      })
      if (!response.body) return { ok: response.ok, status: response.status, text: "" }
      const reader = response.body.getReader()
      const cancel = () => {
        void reader.cancel().catch(() => undefined)
      }
      deadline.addEventListener("abort", cancel, { once: true })
      // These responses contain only grants, state, or acknowledgements, never entity/blob downloads.
      const buffer = new Uint8Array(64 * 1024)
      let length = 0
      try {
        deadline.throwIfAborted()
        while (true) {
          const chunk = await reader.read()
          deadline.throwIfAborted()
          if (chunk.done)
            return {
              ok: response.ok,
              status: response.status,
              text: new TextDecoder().decode(buffer.subarray(0, length)),
            }
          if (chunk.value.byteLength > buffer.byteLength - length) {
            await reader.cancel().catch(() => undefined)
            throw fail(
              "response_too_large",
              "The sync service returned an oversized response; pending changes are retained",
              response.status >= 500 || response.status === 408 || response.status === 429,
            )
          }
          buffer.set(chunk.value, length)
          length += chunk.value.byteLength
        }
      } finally {
        deadline.removeEventListener("abort", cancel)
        reader.releaseLock()
      }
    },
    catch: (cause) =>
      cause instanceof Failure
        ? cause
        : fail("network_error", "The sync service is unreachable; pending changes are retained", true),
  })
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(response.text)
  if (!response.ok) {
    const error = decoded._tag === "Some" ? decodeError(decoded.value) : undefined
    const raw = error?._tag === "Some" ? error.value.error.code : `http_${response.status}`
    const code = Object.hasOwn(errorCodes, raw) ? raw : `http_${response.status}`
    return yield* fail(
      code,
      `Sync service rejected the request (${code})`,
      response.status >= 500 || response.status === 408 || response.status === 429 || code === "upload_in_progress",
      error?._tag === "Some" ? error.value.error.retryAt : undefined,
    )
  }
  if (decoded._tag === "None") return yield* fail("invalid_response", "The sync service returned an invalid response")
  return decoded.value
})

export const decode = <A, I>(schema: Schema.Codec<A, I>, value: unknown) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => fail("invalid_response", "The sync service returned an invalid response")),
  )
