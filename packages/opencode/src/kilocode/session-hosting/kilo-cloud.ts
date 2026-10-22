import { Auth } from "@/auth"
import { CloudAuth } from "@/kilocode/cloud/auth"
import { AgentStartRequestSchema, AgentStartResponseSchema } from "@/kilocode/cloud/contracts"
import { createBearerHttpClient, type BearerRequest } from "@/kilocode/cloud/http"
import { createMessageId } from "@/kilocode/cloud/message-id"
import { resolveCloudAgentOrigin } from "@/kilocode/cloud/origin"
import { readBoundedJson } from "@/kilocode/cloud/response-json"
import { buildKiloHeaders } from "@kilocode/kilo-gateway"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Redacted, Schema } from "effect"
import z from "zod"
import {
  AttachInput,
  GetInput,
  HostedFailure,
  HostedSessionID,
  ListInput,
  ProviderID,
  StartInput,
  TranscriptInput,
  type Attachment,
  type Availability,
  type HostedSession,
  type HostedSessionPage,
  type HostedTranscriptPage,
  type NativeRequest,
  type Provider,
  type StartResult,
  type Transport,
} from "./types"
import { classify } from "./native-routes"

export const PROVIDER = Schema.decodeUnknownSync(ProviderID)("kilo-cloud")
export const ATTACHMENT_TTL_MS = 60_000

const StartEnvelope = z.object({ result: z.object({ data: z.unknown() }) })

export interface Options {
  readonly auth: Auth.Interface
  readonly env?: CloudAuth.Environment
  readonly fetch?: typeof globalThis.fetch
  readonly clock?: () => number
}

/**
 * Built-in adapter for Kilo Cloud. Every provider-private detail the future
 * IDE-facing boundary must not see (Cloud control IDs, target origin, bearer,
 * directory selector, SSE fence) stays inside this module.
 */
export function provider(options: Options): Provider {
  const env = options.env ?? process.env
  const clock = options.clock ?? Date.now
  const transport: { current: Transport } = { current: { state: "unknown" } }

  const provided = <A, E>(effect: Effect.Effect<A, E, Auth.Service>) =>
    Effect.provideService(effect, Auth.Service, options.auth)

  const resolveRaw = (orgID?: string) => provided(CloudAuth.resolve({ orgID, env }))

  const resolve = (orgID?: string) =>
    resolveRaw(orgID).pipe(
      Effect.mapError((error) => {
        if (error._tag !== "CloudAuthResolutionError") {
          return new HostedFailure({
            code: "unavailable",
            message: "Kilo credentials could not be read",
            retryable: true,
          })
        }
        if (error.kind === "missing") {
          return new HostedFailure({ code: "signed_out", message: error.message, retryable: false })
        }
        if (error.kind === "unavailable") {
          return new HostedFailure({ code: "auth_unavailable", message: error.message, retryable: true })
        }
        return new HostedFailure({ code: "rejected", message: error.message, retryable: false })
      }),
    )

  const availability: Effect.Effect<Availability> = Effect.suspend(() => resolveRaw()).pipe(
    Effect.as({ state: "available" } as Availability),
    Effect.catchTag("CloudAuthResolutionError", (error) =>
      Effect.succeed({
        state: "unavailable",
        reason: error.kind === "missing" ? "signed_out" : error.kind === "unavailable" ? "unreachable" : "rejected",
        message: error.message,
      } as Availability),
    ),
  )

  const reachable = () => {
    transport.current = { state: "reachable", checkedAt: clock() }
  }

  const unreachable = () => {
    transport.current = { state: "unreachable", checkedAt: clock(), message: "Kilo Cloud is unreachable" }
  }

  const origin = Effect.try({
    try: () => resolveCloudAgentOrigin(env),
    catch: () => new HostedFailure({ code: "rejected", message: "Kilo Cloud base URL is invalid", retryable: false }),
  })

  const request = (auth: CloudAuth.Resolved, req: BearerRequest) =>
    Effect.gen(function* () {
      const base = yield* origin
      const response = yield* Effect.tryPromise({
        try: () =>
          createBearerHttpClient({
            origin: base,
            apiKey: Redacted.value(auth.token),
            ...(options.fetch ? { fetch: options.fetch } : {}),
          }).request(req),
        catch: () => {
          unreachable()
          return new HostedFailure({ code: "unavailable", message: "Kilo Cloud is unreachable", retryable: true })
        },
      })
      reachable()
      return response
    })

  const headers = (auth: CloudAuth.Resolved) =>
    buildKiloHeaders(undefined, auth.organizationID ? { kilocodeOrganizationId: auth.organizationID } : undefined)

  const decodeBody = (response: Response) =>
    Effect.tryPromise({
      try: () => readBoundedJson(response),
      catch: () =>
        new HostedFailure({
          code: "invalid_response",
          message: "Kilo Cloud returned an invalid response",
          retryable: false,
        }),
    })

  const failure = (response: Response, body: unknown) => {
    const code = errorCode(body)
    if (response.status === 401 || response.status === 403) {
      return new HostedFailure({
        code: "unauthorized",
        message: "Kilo Cloud rejected these credentials",
        retryable: false,
      })
    }
    if (response.status === 402) {
      return new HostedFailure({
        code: "payment_required",
        message: "Kilo Cloud requires additional balance",
        retryable: false,
      })
    }
    if (response.status === 404) {
      return new HostedFailure({ code: "not_found", message: "Kilo Cloud session was not found", retryable: false })
    }
    if (response.status === 409) {
      return new HostedFailure({
        code: "rejected",
        message: "Kilo Cloud rejected this operation",
        retryable: code === "KILO_INTERACTION_UNAVAILABLE",
      })
    }
    if (response.status === 503 || response.status >= 500) {
      return new HostedFailure({
        code: "unavailable",
        message: "Kilo Cloud is temporarily unavailable",
        retryable: true,
      })
    }
    return new HostedFailure({ code: "rejected", message: "Kilo Cloud rejected the request", retryable: false })
  }

  const consume = (response: Response) =>
    Effect.gen(function* () {
      if (response.ok) return yield* decodeBody(response)
      const body = yield* decodeBody(response).pipe(Effect.catch(() => Effect.succeed(undefined)))
      return yield* Effect.fail(failure(response, body))
    })

  const codec = (schema: Schema.Top) => schema as Schema.Codec<unknown, unknown>

  const decode = <S extends Schema.Top>(schema: S, value: unknown, message: string) =>
    Effect.try({
      try: () => Schema.decodeUnknownSync(codec(schema))(value) as S["Type"],
      catch: () => new HostedFailure({ code: "invalid_response", message, retryable: false }),
    })

  const check = <S extends Schema.Top>(schema: S, value: unknown) =>
    Effect.try({
      try: () => Schema.decodeUnknownSync(codec(schema))(value) as S["Type"],
      catch: () =>
        new HostedFailure({ code: "invalid_request", message: "Session host request is invalid", retryable: false }),
    })

  const invalid = (message: string) => new HostedFailure({ code: "invalid_response", message, retryable: false })

  const identity = (sessionID: unknown) =>
    decode(HostedSessionID, { providerID: PROVIDER, sessionID }, "Kilo Cloud returned an unsupported session identity")

  const hosted = (session: SessionV1.SessionInfo) =>
    identity(session.id).pipe(Effect.map((id): HostedSession => ({ id, session })))

  const list = (raw: ListInput = {}): Effect.Effect<HostedSessionPage, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(ListInput, raw)
      const auth = yield* resolve(input.organizationID)
      const query = new URLSearchParams()
      if (input.limit !== undefined) query.set("limit", String(input.limit))
      const response = yield* request(auth, {
        method: "GET",
        path: route("/kilo/session", query),
        headers: headers(auth),
      })
      const body = yield* consume(response)
      const sessions = yield* decode(
        Schema.Array(SessionV1.SessionInfo),
        body,
        "Kilo Cloud returned unsupported sessions",
      )
      return { items: yield* Effect.forEach(sessions, hosted) }
    })

  const get = (raw: GetInput): Effect.Effect<HostedSession, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(GetInput, raw)
      const auth = yield* resolve(input.organizationID)
      const response = yield* request(auth, {
        method: "GET",
        path: `/kilo/session/${input.id.sessionID}`,
        headers: headers(auth),
      })
      const body = yield* consume(response)
      const session = yield* decode(SessionV1.SessionInfo, body, "Kilo Cloud returned an unsupported session")
      if (session.id !== input.id.sessionID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a different session identity"))
      }
      return yield* hosted(session)
    })

  const transcript = (raw: TranscriptInput): Effect.Effect<HostedTranscriptPage, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(TranscriptInput, raw)
      const auth = yield* resolve(input.organizationID)
      const query = new URLSearchParams()
      if (input.limit !== undefined) query.set("limit", String(input.limit))
      if (input.before !== undefined) query.set("before", input.before)
      const response = yield* request(auth, {
        method: "GET",
        path: route(`/kilo/session/${input.id.sessionID}/message`, query),
        headers: headers(auth),
      })
      const body = yield* consume(response)
      const entries = yield* decode(
        Schema.Array(SessionV1.WithParts),
        body,
        "Kilo Cloud returned an unsupported transcript",
      )
      for (const entry of entries) {
        if (entry.info.sessionID !== input.id.sessionID) {
          return yield* Effect.fail(invalid("Kilo Cloud returned a transcript for a different session"))
        }
      }
      const cursor = response.headers.get("X-Next-Cursor")
      const omitted = omittedCount(response.headers.get("X-Kilo-Omitted-Item-Count"))
      return {
        items: entries,
        ...(cursor ? { cursor } : {}),
        ...(omitted === undefined ? {} : { omitted }),
      }
    })

  const start = (raw: StartInput): Effect.Effect<StartResult, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(StartInput, raw)
      const auth = yield* resolve(input.organizationID)
      const messageID = input.messageID ?? createMessageId()
      const payload = {
        message: { prompt: input.prompt, id: messageID },
        agent: { mode: input.agent.mode, model: input.agent.model },
        repository: input.repository,
        options: {
          createdOnPlatform: input.origin === "desktop" ? "desktop" : "kilo-cli",
          ...(auth.organizationID ? { kilocodeOrganizationId: auth.organizationID } : {}),
        },
        ...(input.operationKey ? { operationKey: input.operationKey } : {}),
      }
      const parsed = AgentStartRequestSchema.safeParse(payload)
      if (!parsed.success) {
        return yield* Effect.fail(
          new HostedFailure({ code: "invalid_request", message: "Session start request is invalid", retryable: false }),
        )
      }
      const response = yield* request(auth, {
        method: "POST",
        path: "/trpc/start",
        headers: { ...headers(auth), "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      }).pipe(
        Effect.mapError((error) => {
          if (error.code !== "unavailable" || !error.retryable || input.operationKey !== undefined) return error
          return new HostedFailure({
            code: "unavailable",
            message: "Kilo Cloud start outcome is unknown; retry with the same operation key and message ID",
            retryable: false,
          })
        }),
      )
      const body = yield* consume(response)
      const envelope = StartEnvelope.safeParse(body)
      const parsedResult = envelope.success ? AgentStartResponseSchema.safeParse(envelope.data.result.data) : envelope
      if (!parsedResult.success) {
        return yield* Effect.fail(
          new HostedFailure({
            code: "invalid_response",
            message: "Kilo Cloud returned an unsupported start result",
            retryable: false,
          }),
        )
      }
      const result = parsedResult.data
      if (result.messageId !== messageID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a different message identity"))
      }
      if (result.delivery !== "sent" && result.delivery !== "queued") {
        return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported delivery state"))
      }
      const session = yield* identity(result.kiloSessionId)
      return {
        session,
        messageID,
        delivery: result.delivery,
        replayed: result.replayed === true,
      }
    })

  const attach = (raw: AttachInput): Effect.Effect<Attachment, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(AttachInput, raw)
      const session = yield* get(input)
      return { session: session.id, expiresAt: clock() + ATTACHMENT_TTL_MS }
    })

  /**
   * Maps one allowlisted native request onto the merged `/kilo` facade. Cloud
   * control identities, origin, bearer, selector, and fence never leave this
   * module.
   */
  const native = (input: NativeRequest): Effect.Effect<Response, HostedFailure> =>
    Effect.gen(function* () {
      const mapped = classify(input.session.sessionID, input.method, input.path, input.query)
      if (mapped === undefined) {
        return yield* Effect.fail(
          new HostedFailure({
            code: "invalid_request",
            message: "Native route is not supported by this session host",
            retryable: false,
          }),
        )
      }
      if (mapped.kind === "mismatch") {
        return yield* Effect.fail(
          new HostedFailure({
            code: "invalid_request",
            message: "Session identity does not match this attachment",
            retryable: false,
          }),
        )
      }
      const auth = yield* resolve(input.organizationID)
      const headers: Record<string, string> = {
        ...buildKiloHeaders(undefined, auth.organizationID ? { kilocodeOrganizationId: auth.organizationID } : undefined),
      }
      for (const [key, value] of input.headers.entries()) headers[key] = value
      const query = mapped.query.toString()
      return yield* request(auth, {
        method: mapped.method,
        path: query.length === 0 ? mapped.remote : `${mapped.remote}?${query}`,
        headers,
        ...(input.body && input.body.length > 0
          ? { body: new Blob([new Uint8Array(input.body).buffer]) }
          : {}),
        // The native event stream is long-lived; every other call keeps the default bound.
        ...(mapped.remote === "/kilo/event" ? { timeoutMs: 0 } : {}),
      })
    })

  return {
    id: PROVIDER,
    default: true,
    availability,
    transport: Effect.sync(() => transport.current),
    list,
    get,
    transcript,
    start,
    attach,
    route: native,
  }
}

function route(base: `/${string}`, query: URLSearchParams): `/${string}` {
  return query.size === 0 ? base : `${base}?${query.toString()}`
}

function errorCode(value: unknown) {
  if (value === null || typeof value !== "object") return undefined
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  return typeof record.error === "string" ? record.error : undefined
}

function omittedCount(value: string | null) {
  if (value === null || !/^\d+$/.test(value)) return undefined
  const count = Number(value)
  return Number.isSafeInteger(count) ? count : undefined
}
