import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Schema } from "effect"

/**
 * Provider-neutral Session Host contract. These types are the boundary the
 * future local API and IDE integrations consume; nothing provider-private
 * (target URL, credential, Cloud control ID, fence) belongs here.
 */

export const ProviderID = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z][a-z0-9-]*$/),
)
  .pipe(Schema.brand("SessionHostProviderID"))
  .annotate({ identifier: "SessionHostProviderID" })
export type ProviderID = Schema.Schema.Type<typeof ProviderID>

export const RemoteSessionID = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
  Schema.isPattern(/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/),
).annotate({ identifier: "SessionHostRemoteSessionID" })
export type RemoteSessionID = Schema.Schema.Type<typeof RemoteSessionID>

/**
 * Hosted identity is composite. A remote provider's bare session ID is never
 * an identity on its own, so equal remote IDs in two providers cannot collide.
 */
export const HostedSessionID = Schema.Struct({
  providerID: ProviderID,
  sessionID: RemoteSessionID,
}).annotate({ identifier: "SessionHostIdentity" })
export type HostedSessionID = Schema.Schema.Type<typeof HostedSessionID>

export function key(id: HostedSessionID) {
  return `${id.providerID}:${id.sessionID}`
}

export function equal(a: HostedSessionID, b: HostedSessionID) {
  return key(a) === key(b)
}

/**
 * Whether the provider can serve requests at all. This is not session turn
 * state and not transport state: durable reads stay available while a runtime
 * is idle-stopped, and a disconnected transport does not change availability.
 */
export const Availability = Schema.Union([
  Schema.Struct({ state: Schema.Literal("available") }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    reason: Schema.Literals(["signed_out", "rejected", "unreachable"]),
    message: Schema.String,
  }),
]).annotate({ identifier: "SessionHostAvailability" })
export type Availability = Schema.Schema.Type<typeof Availability>

/**
 * Result of the most recent request attempt. Kept separate from availability
 * so a transient failure never masquerades as a lifecycle or auth change.
 */
export const Transport = Schema.Union([
  Schema.Struct({ state: Schema.Literal("unknown") }),
  Schema.Struct({ state: Schema.Literal("reachable"), checkedAt: Schema.Finite }),
  Schema.Struct({
    state: Schema.Literal("unreachable"),
    checkedAt: Schema.Finite,
    message: Schema.String,
  }),
]).annotate({ identifier: "SessionHostTransport" })
export type Transport = Schema.Schema.Type<typeof Transport>

export const FailureCode = Schema.Literals([
  "signed_out",
  "unauthorized",
  "payment_required",
  "not_found",
  "invalid_request",
  "invalid_response",
  "auth_unavailable",
  "rejected",
  "unavailable",
  "unknown_provider",
]).annotate({ identifier: "SessionHostFailureCode" })
export type FailureCode = Schema.Schema.Type<typeof FailureCode>

export class HostedFailure extends Schema.TaggedErrorClass<HostedFailure>()("SessionHostFailure", {
  code: FailureCode,
  message: Schema.String,
  retryable: Schema.Boolean,
}) {}

export const HostedSession = Schema.Struct({
  id: HostedSessionID,
  session: SessionV1.SessionInfo,
}).annotate({ identifier: "SessionHostSession" })
export type HostedSession = Schema.Schema.Type<typeof HostedSession>

export const HostedSessionPage = Schema.Struct({
  items: Schema.Array(HostedSession),
}).annotate({ identifier: "SessionHostSessionPage" })
export type HostedSessionPage = Schema.Schema.Type<typeof HostedSessionPage>

export const HostedTranscriptPage = Schema.Struct({
  items: Schema.Array(SessionV1.WithParts),
  cursor: Schema.optional(Schema.String),
  omitted: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
}).annotate({ identifier: "SessionHostTranscriptPage" })
export type HostedTranscriptPage = Schema.Schema.Type<typeof HostedTranscriptPage>

/**
 * Opaque attachment validity window. Provider routing material (target origin,
 * selector, credential, fence) is deliberately absent: the local attachment
 * API and its proxy hooks are introduced by the next issue.
 */
export const Attachment = Schema.Struct({
  session: HostedSessionID,
  expiresAt: Schema.Finite,
}).annotate({ identifier: "SessionHostAttachment" })
export type Attachment = Schema.Schema.Type<typeof Attachment>

export const Repository = Schema.Union([
  Schema.Struct({ type: Schema.Literal("github"), repo: Schema.String, branch: Schema.optional(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("gitlab"), url: Schema.String, branch: Schema.optional(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("git"), url: Schema.String, branch: Schema.optional(Schema.String) }),
]).annotate({ identifier: "SessionHostRepository" })
export type Repository = Schema.Schema.Type<typeof Repository>

export const Origin = Schema.Literals(["cli", "desktop"]).annotate({ identifier: "SessionHostOrigin" })
export type Origin = Schema.Schema.Type<typeof Origin>

export const OrganizationID = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)).annotate({
  identifier: "SessionHostOrganizationID",
})
export type OrganizationID = Schema.Schema.Type<typeof OrganizationID>

export const ListInput = Schema.Struct({
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostListInput" })
export type ListInput = Schema.Schema.Type<typeof ListInput>

export const GetInput = Schema.Struct({
  id: HostedSessionID,
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostGetInput" })
export type GetInput = Schema.Schema.Type<typeof GetInput>

export const TranscriptInput = Schema.Struct({
  id: HostedSessionID,
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  before: Schema.optional(Schema.String),
  organizationID: Schema.optional(OrganizationID),
}).annotate({ identifier: "SessionHostTranscriptInput" })
export type TranscriptInput = Schema.Schema.Type<typeof TranscriptInput>

export const AttachInput = GetInput.annotate({ identifier: "SessionHostAttachInput" })
export type AttachInput = Schema.Schema.Type<typeof AttachInput>

export const StartInput = Schema.Struct({
  repository: Repository,
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)),
  agent: Schema.Struct({
    mode: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50)),
    model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  }),
  organizationID: Schema.optional(OrganizationID),
  origin: Schema.optional(Origin),
  /** Stable idempotency key. Reuse it with the same `messageID` to retry safely. */
  operationKey: Schema.optional(Schema.String),
  /** Stable initial message identity. Required for a retry-safe start after an ambiguous failure. */
  messageID: Schema.optional(Schema.String),
})
  .check(
    Schema.makeFilter((input) =>
      input.operationKey === undefined || input.messageID !== undefined
        ? undefined
        : "messageID is required when operationKey is supplied",
    ),
  )
  .annotate({ identifier: "SessionHostStartInput" })
export type StartInput = Schema.Schema.Type<typeof StartInput>

export const StartResult = Schema.Struct({
  session: HostedSessionID,
  messageID: Schema.String,
  delivery: Schema.Literals(["sent", "queued"]),
  replayed: Schema.Boolean,
}).annotate({ identifier: "SessionHostStartResult" })
export type StartResult = Schema.Schema.Type<typeof StartResult>

/**
 * A proven native request bound to one hosted session. The local attachment
 * layer reduces the inbound request to this shape before the provider maps it,
 * so local credentials, cookies, and selectors never reach the provider.
 */
export interface NativeRequest {
  readonly session: HostedSessionID
  readonly method: string
  readonly path: string
  readonly query: URLSearchParams
  readonly headers: Headers
  /** Native request bodies are JSON bytes; binary content travels base64 inside JSON. */
  readonly body?: Uint8Array
  readonly organizationID?: string
}

export interface Provider {
  readonly id: ProviderID
  readonly default?: boolean
  readonly availability: Effect.Effect<Availability>
  readonly transport: Effect.Effect<Transport>
  readonly list: (input?: ListInput) => Effect.Effect<HostedSessionPage, HostedFailure>
  readonly get: (input: GetInput) => Effect.Effect<HostedSession, HostedFailure>
  readonly transcript: (input: TranscriptInput) => Effect.Effect<HostedTranscriptPage, HostedFailure>
  readonly start: (input: StartInput) => Effect.Effect<StartResult, HostedFailure>
  readonly attach: (input: AttachInput) => Effect.Effect<Attachment, HostedFailure>
  /**
   * Provider-owned request mapping for the proven native allowlist. Provider
   * origin, credentials, control identities, selectors, and fences stay inside
   * the implementation. Omitted by providers without native routing.
   */
  readonly route?: (input: NativeRequest) => Effect.Effect<Response, HostedFailure>
}
