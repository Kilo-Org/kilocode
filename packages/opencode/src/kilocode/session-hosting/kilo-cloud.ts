import { Auth } from "@/auth"
import { CloudAuth } from "@/kilocode/cloud/auth"
import { AgentStartRequestSchema, AgentStartResponseSchema } from "@/kilocode/cloud/contracts"
import { ControlTokenError, createControlTokenClient, type ControlTokenClient } from "@/kilocode/cloud/control-token"
import { createBearerHttpClient, type BearerRequest } from "@/kilocode/cloud/http"
import { createMessageId } from "@/kilocode/cloud/message-id"
import { resolveCloudAgentOrigin, resolveKiloApiOrigin, resolveWebAppOrigin } from "@/kilocode/cloud/origin"
import { readBoundedJson } from "@/kilocode/cloud/response-json"
import { buildKiloHeaders } from "@kilocode/kilo-gateway"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Redacted, Schema } from "effect"
import z from "zod"
import {
  AttachInput,
  CreateWorkspaceInput,
  GetInput,
  HostedFailure,
  HostedSessionID,
  HostedWorkspaceID,
  ListInput,
  ProviderID,
  StartInput,
  TranscriptInput,
  WorkspaceDeleteInput,
  WorkspaceGetInput,
  WorkspaceListInput,
  WorkspaceProfileListInput,
  WorkspaceSessionStartInput,
  WorkspaceStatusInput,
  markDeletionDispatched,
  type Attachment,
  type Availability,
  type CreateWorkspaceResult,
  type DeleteWorkspaceResult,
  type HostedSession,
  type HostedSessionPage,
  type HostedTranscriptPage,
  type HostedWorkspace,
  type HostedWorkspacePage,
  type HostedWorkspaceStatus,
  type NativeRequest,
  type Provider,
  type Repository,
  type Agent,
  type Profile,
  type StartResult,
  type Transport,
  type WorkspaceProfilePage,
  type WorkspaceSessionStartResult,
} from "./types"
import { classify } from "./native-routes"
import { errorCode } from "./response"

export const PROVIDER = Schema.decodeUnknownSync(ProviderID)("kilo-cloud")
export const ATTACHMENT_TTL_MS = 60_000

const MEMBERSHIP_PAGE_SIZE = 50
const MEMBERSHIP_SESSION_LIMIT = 100
const MEMBERSHIP_PAGE_LIMIT = 20
const MEMBERSHIP_SESSION_PAGE_LIMIT = 10

const Envelope = z.object({ result: z.object({ data: z.unknown() }) })

const WorkspaceSessionSummary = z.object({
  kiloSessionId: z.string().min(1),
  cloudAgentSessionId: z.string().min(1),
  workspaceId: z.string().min(1).nullable(),
  userId: z.string().min(1),
  organizationId: z.string().nullable(),
  title: z.string().nullable(),
  gitUrl: z.string().nullable(),
  gitBranch: z.string().nullable(),
  profileId: z.string().nullable(),
  createdOnPlatform: z.string().min(1),
  created: z.number(),
  updated: z.number(),
})

const WorkspaceSummary = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  organizationId: z.string().nullable(),
  name: z.string().nullable(),
  repositoryProvider: z.enum(["github", "gitlab", "bitbucket", "git"]).nullable(),
  gitUrl: z.string().nullable(),
  gitBranch: z.string().nullable(),
  profileId: z.string().nullable(),
  deletionState: z.enum(["active", "deleting", "deleted"]),
  created: z.number(),
  updated: z.number(),
  lastActivity: z.number(),
  sessions: z.array(WorkspaceSessionSummary),
  nextSessionCursor: z.string().nullable(),
})

const WorkspacePage = z.object({
  items: z.array(WorkspaceSummary),
  nextCursor: z.string().nullable(),
})

const CloudWorkspaceStatus = z.object({
  workspaceId: z.string().min(1),
  deletionState: z.enum(["active", "deleting", "deleted"]),
  observedAt: z.number(),
  compute: z.object({
    status: z.enum(["active", "sleeping", "starting", "stopping", "error", "unreachable", "unknown"]),
    detailCode: z.enum([
      "sandbox_ready",
      "sandbox_stopped",
      "sandbox_starting",
      "sandbox_stopping",
      "sandbox_failed",
      "connection_unavailable",
      "status_unavailable",
      "insufficient_evidence",
      "check_needed",
    ]),
    observedAt: z.number(),
    estimatedSleepAt: z.number().nullable(),
  }),
  activity: z.object({
    activeSessionCount: z.number(),
    hasActiveTurn: z.boolean(),
  }),
  wakeOnInput: z.object({
    available: z.boolean(),
    blockedReason: z.enum(["deleting", "deleted", "billing_blocked", "billing_status_unavailable"]).nullable(),
  }),
  billing: z.object({
    payer: z.object({ type: z.enum(["user", "org"]), id: z.string() }).nullable(),
    sku: z.string().nullable(),
    blocked: z.boolean().nullable(),
    enforcementRequested: z.boolean(),
    intervalStartedAt: z.number().nullable(),
    rate: z
      .object({
        rateCentsPerSecond: z.string(),
        estimatedHourlyMicrodollars: z.number(),
      })
      .nullable(),
  }),
  deletion: z.object({
    started: z.boolean(),
    completed: z.boolean(),
    startedAt: z.number().nullable(),
    phase: z.enum(["not_started", "runtime_cleanup", "finalizing", "completed"]),
    sessionCount: z.number(),
    runtimeLocationCount: z.number(),
    completedRuntimeLocationCount: z.number(),
    remainingRuntimeLocationCount: z.number(),
    deletedSessionIds: z.array(z.string()),
  }),
})

const WorkspaceCreate = z.object({
  workspaceId: z.string().min(1),
  cloudAgentSessionId: z.string().min(1),
  kiloSessionId: z.string().min(1),
  messageId: z.string().min(1),
  replayed: z.boolean().optional(),
})

const WorkspaceDelete = z.object({
  success: z.literal(true),
  deletedSessionIds: z.array(z.string()),
})

const CloudProfile = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  isDefault: z.boolean(),
})

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

  const webOrigin = Effect.try({
    try: () => resolveWebAppOrigin(env),
    catch: () => new HostedFailure({ code: "rejected", message: "Kilo web app URL is invalid", retryable: false }),
  })

  const apiOrigin = Effect.try({
    try: () => resolveKiloApiOrigin(env),
    catch: () => new HostedFailure({ code: "rejected", message: "Kilo API base URL is invalid", retryable: false }),
  })

  const controlTokens: ControlTokenClient = createControlTokenClient({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    clock,
  })

  const controlError = (error: unknown): HostedFailure => {
    if (error instanceof ControlTokenError) {
      if (error.reason === "unauthorized") {
        return new HostedFailure({ code: "unauthorized", message: error.message, retryable: false })
      }
      if (error.reason === "invalid_response") {
        return new HostedFailure({ code: "invalid_response", message: error.message, retryable: false })
      }
    }
    unreachable()
    return new HostedFailure({
      code: "unavailable",
      message: error instanceof ControlTokenError ? error.message : "Kilo control token could not be issued",
      retryable: true,
    })
  }

  /**
   * Every Worker call exchanges the original user source credential for a
   * short-lived control token first. The source credential is presented only to
   * the issuer; the Worker sees only the control token.
   */
  const request = (auth: CloudAuth.Resolved, req: BearerRequest, retryable = true) =>
    Effect.gen(function* () {
      const base = yield* origin
      const issuer = yield* webOrigin
      const control = yield* Effect.tryPromise({
        try: () =>
          controlTokens.exchange({
            source: auth.token,
            ...(auth.organizationID ? { organizationID: auth.organizationID } : {}),
            issuer,
            worker: base,
          }),
        catch: controlError,
      })
      const response = yield* Effect.tryPromise({
        try: () =>
          createBearerHttpClient({
            origin: base,
            apiKey: Redacted.value(control.token),
            ...(options.fetch ? { fetch: options.fetch } : {}),
          }).request(req),
        catch: () => {
          unreachable()
          return new HostedFailure({
            code: "unavailable",
            message: retryable
              ? "Kilo Cloud is unreachable"
              : "Kilo Cloud start outcome is unknown; retry with the same operation key and message ID",
            retryable,
          })
        },
      })
      reachable()
      return response
    })

  /**
   * Account API calls use the source credential directly at the API origin.
   * They never pass through the Worker control-token exchange.
   */
  const apiRequest = (auth: CloudAuth.Resolved, req: BearerRequest) =>
    Effect.gen(function* () {
      const base = yield* apiOrigin
      const response = yield* Effect.tryPromise({
        try: () =>
          createBearerHttpClient({
            origin: base,
            apiKey: Redacted.value(auth.token),
            ...(options.fetch ? { fetch: options.fetch } : {}),
          }).request(req),
        catch: () => {
          unreachable()
          return new HostedFailure({
            code: "unavailable",
            message: "Kilo API is unreachable",
            retryable: true,
          })
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
      const response = yield* request(
        auth,
        {
          method: "POST",
          path: "/trpc/start",
          headers: { ...headers(auth), "content-type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
        input.operationKey !== undefined,
      )
      const body = yield* consume(response)
      const envelope = Envelope.safeParse(body)
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

  const data = (value: unknown) =>
    Effect.gen(function* () {
      const envelope = Envelope.safeParse(value)
      if (!envelope.success) return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported response"))
      return envelope.data.result.data
    })

  const query = (auth: CloudAuth.Resolved, procedure: string, input: unknown) =>
    request(auth, {
      method: "GET",
      path: `/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`,
      headers: headers(auth),
    }).pipe(Effect.flatMap(consume), Effect.flatMap(data))

  const mutation = (auth: CloudAuth.Resolved, procedure: string, input: unknown) =>
    request(auth, {
      method: "POST",
      path: `/trpc/${procedure}`,
      headers: { ...headers(auth), "content-type": "application/json" },
      body: JSON.stringify(input),
    }).pipe(Effect.flatMap(consume), Effect.flatMap(data))

  const consistent = (raw: z.infer<typeof WorkspaceSummary>) =>
    raw.sessions.every((session) => session.workspaceId === raw.workspaceId)

  const holds = (raw: z.infer<typeof WorkspaceSummary>, kiloSessionID: string) =>
    raw.sessions.some((session) => session.kiloSessionId === kiloSessionID)

  /**
   * Resolves workspace membership from the existing workspace catalog, once
   * per new attachment. A session that no catalog page mentions is a legacy
   * flat session, so the attachment stays valid without workspace-scoped
   * invalidation. A catalog larger than the scan bound, or a workspace that
   * disappears during the scan, also yields no membership; routed
   * session-not-found responses still invalidate the attachment.
   */
  const membership = (raw: AttachInput): Effect.Effect<HostedWorkspaceID | undefined, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(AttachInput, raw)
      const auth = yield* resolve(input.organizationID)
      const kiloSessionID = input.id.sessionID
      let cursor: string | undefined
      for (let page = 0; page < MEMBERSHIP_PAGE_LIMIT; page++) {
        const payload: Record<string, unknown> = {
          limit: MEMBERSHIP_PAGE_SIZE,
          sessionLimit: MEMBERSHIP_SESSION_LIMIT,
        }
        if (cursor !== undefined) payload.cursor = cursor
        const body = yield* query(auth, "listHostedWorkspaces", payload)
        const parsed = WorkspacePage.safeParse(body)
        if (!parsed.success) return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace page"))
        for (const raw of parsed.data.items) {
          const found = yield* nested(auth, raw, kiloSessionID)
          if (found !== undefined) return yield* workspaceIdentity(found)
        }
        if (parsed.data.nextCursor == null) return undefined
        cursor = parsed.data.nextCursor
      }
      return undefined
    })

  const nested = (
    auth: CloudAuth.Resolved,
    raw: z.infer<typeof WorkspaceSummary>,
    kiloSessionID: string,
  ): Effect.Effect<string | undefined, HostedFailure> =>
    Effect.gen(function* () {
      if (!consistent(raw)) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a workspace with a session from another workspace"))
      }
      if (holds(raw, kiloSessionID)) return raw.workspaceId

      let cursor: string | null = raw.nextSessionCursor
      for (let page = 0; cursor != null && page < MEMBERSHIP_SESSION_PAGE_LIMIT; page++) {
        const body = yield* query(auth, "getHostedWorkspace", {
          workspaceId: raw.workspaceId,
          sessionLimit: MEMBERSHIP_SESSION_LIMIT,
          sessionCursor: cursor,
        })
        // This workspace disappeared during the scan; it says nothing about the session.
        if (body === null) return undefined
        const parsed = WorkspaceSummary.safeParse(body)
        if (!parsed.success) return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace"))
        if (parsed.data.workspaceId !== raw.workspaceId) {
          return yield* Effect.fail(invalid("Kilo Cloud returned a different workspace identity"))
        }
        if (!consistent(parsed.data)) {
          return yield* Effect.fail(invalid("Kilo Cloud returned a workspace with a session from another workspace"))
        }
        if (holds(parsed.data, kiloSessionID)) return parsed.data.workspaceId
        cursor = parsed.data.nextSessionCursor
      }
      return undefined
    })

  const workspaceIdentity = (workspaceID: unknown) =>
    decode(
      HostedWorkspaceID,
      { providerID: PROVIDER, workspaceID },
      "Kilo Cloud returned an unsupported workspace identity",
    )

  const workspace = (raw: z.infer<typeof WorkspaceSummary>): Effect.Effect<HostedWorkspace, HostedFailure> =>
    Effect.gen(function* () {
      if (!consistent(raw)) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a workspace with a session from another workspace"))
      }
      const id = yield* workspaceIdentity(raw.workspaceId)
      const sessions = yield* Effect.forEach(raw.sessions, (session) =>
        identity(session.kiloSessionId).pipe(
          Effect.map((sessionID) => ({
            id: sessionID,
            ...(session.title == null ? {} : { title: session.title }),
            createdOnPlatform: session.createdOnPlatform,
            created: session.created,
            updated: session.updated,
          })),
        ),
      )
      return {
        id,
        ...(raw.name == null ? {} : { name: raw.name }),
        repository: {
          ...(raw.repositoryProvider == null ? {} : { provider: raw.repositoryProvider }),
          ...(raw.gitUrl == null ? {} : { url: raw.gitUrl }),
          ...(raw.gitBranch == null ? {} : { branch: raw.gitBranch }),
        },
        ...(raw.profileId == null ? {} : { profileID: raw.profileId }),
        deletionState: raw.deletionState,
        created: raw.created,
        updated: raw.updated,
        lastActivity: raw.lastActivity,
        sessions,
        ...(raw.nextSessionCursor == null ? {} : { cursor: raw.nextSessionCursor }),
      }
    })

  const listWorkspaces = (raw: WorkspaceListInput = {}): Effect.Effect<HostedWorkspacePage, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceListInput, raw)
      const auth = yield* resolve(input.organizationID)
      const payload: Record<string, unknown> = {}
      if (input.limit !== undefined) payload.limit = input.limit
      if (input.sessionLimit !== undefined) payload.sessionLimit = input.sessionLimit
      if (input.cursor !== undefined) payload.cursor = input.cursor
      if (input.repositoryUrl !== undefined) payload.repositoryUrl = input.repositoryUrl
      const body = yield* query(auth, "listHostedWorkspaces", payload)
      const parsed = WorkspacePage.safeParse(body)
      if (!parsed.success) return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace page"))
      const items = yield* Effect.forEach(parsed.data.items, workspace)
      return { items, ...(parsed.data.nextCursor == null ? {} : { cursor: parsed.data.nextCursor }) }
    })

  const getWorkspace = (raw: WorkspaceGetInput): Effect.Effect<HostedWorkspace, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceGetInput, raw)
      const auth = yield* resolve(input.organizationID)
      const payload: Record<string, unknown> = { workspaceId: input.id.workspaceID }
      if (input.sessionLimit !== undefined) payload.sessionLimit = input.sessionLimit
      if (input.sessionCursor !== undefined) payload.sessionCursor = input.sessionCursor
      const body = yield* query(auth, "getHostedWorkspace", payload)
      if (body === null) {
        return yield* Effect.fail(
          new HostedFailure({ code: "not_found", message: "Kilo Cloud workspace was not found", retryable: false }),
        )
      }
      const parsed = WorkspaceSummary.safeParse(body)
      if (!parsed.success) return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace"))
      if (parsed.data.workspaceId !== input.id.workspaceID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a different workspace identity"))
      }
      return yield* workspace(parsed.data)
    })

  const getWorkspaceStatus = (raw: WorkspaceStatusInput): Effect.Effect<HostedWorkspaceStatus, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceStatusInput, raw)
      const auth = yield* resolve(input.organizationID)
      const body = yield* query(auth, "getHostedWorkspaceStatus", {
        workspaceId: input.id.workspaceID,
        ...(input.organizationID === undefined ? {} : { kilocodeOrganizationId: input.organizationID }),
      })
      const parsed = CloudWorkspaceStatus.safeParse(body)
      if (!parsed.success) return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace status"))
      if (parsed.data.workspaceId !== input.id.workspaceID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a status for a different workspace"))
      }
      const id = yield* workspaceIdentity(parsed.data.workspaceId)
      return {
        id,
        deletionState: parsed.data.deletionState,
        observedAt: parsed.data.observedAt,
        compute: {
          status: parsed.data.compute.status,
          detailCode: parsed.data.compute.detailCode,
          observedAt: parsed.data.compute.observedAt,
          estimatedSleepAt: parsed.data.compute.estimatedSleepAt,
        },
        activity: {
          activeSessionCount: parsed.data.activity.activeSessionCount,
          hasActiveTurn: parsed.data.activity.hasActiveTurn,
        },
        wakeOnInput: {
          available: parsed.data.wakeOnInput.available,
          blockedReason: parsed.data.wakeOnInput.blockedReason,
        },
        billing: {
          payer: parsed.data.billing.payer?.type ?? null,
          sku: parsed.data.billing.sku,
          blocked: parsed.data.billing.blocked,
          enforcementRequested: parsed.data.billing.enforcementRequested,
          intervalStartedAt: parsed.data.billing.intervalStartedAt,
          rate: parsed.data.billing.rate,
        },
        deletion: {
          started: parsed.data.deletion.started,
          completed: parsed.data.deletion.completed,
          startedAt: parsed.data.deletion.startedAt,
          phase: parsed.data.deletion.phase,
          sessionCount: parsed.data.deletion.sessionCount,
          runtimeLocationCount: parsed.data.deletion.runtimeLocationCount,
          completedRuntimeLocationCount: parsed.data.deletion.completedRuntimeLocationCount,
          remainingRuntimeLocationCount: parsed.data.deletion.remainingRuntimeLocationCount,
        },
      } satisfies HostedWorkspaceStatus
    })

  const deleteWorkspace = (raw: WorkspaceDeleteInput): Effect.Effect<DeleteWorkspaceResult, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceDeleteInput, raw)
      const auth = yield* resolve(input.organizationID)
      // Failures from this request happen before Cloud admits the deletion. Only
      // a malformed response after dispatch may invalidate local attachments.
      const response = yield* request(auth, {
        method: "POST",
        path: "/trpc/deleteWorktree",
        headers: { ...headers(auth), "content-type": "application/json" },
        body: JSON.stringify({
          worktreeId: input.id.workspaceID,
          ...(input.organizationID === undefined ? {} : { kilocodeOrganizationId: input.organizationID }),
        }),
      })
      const body = yield* consume(response).pipe(
        Effect.flatMap(data),
        Effect.catch((error) => Effect.fail(error.code === "invalid_response" ? markDeletionDispatched(error) : error)),
      )
      const parsed = WorkspaceDelete.safeParse(body)
      if (!parsed.success) {
        return yield* Effect.fail(
          markDeletionDispatched(invalid("Kilo Cloud returned an unsupported workspace deletion result")),
        )
      }
      return { workspace: input.id, success: true }
    })

  const createWorkspace = (raw: CreateWorkspaceInput): Effect.Effect<CreateWorkspaceResult, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(CreateWorkspaceInput, raw)
      const auth = yield* resolve(input.organizationID)
      const body = yield* mutation(auth, "createHostedWorkspace", {
        operationKey: input.operationKey,
        clientProvenance: "agent-manager",
        repository: repositoryPayload(input.repository),
        profile: profilePayload(input.profile),
        message: { prompt: input.prompt, id: input.messageID },
        agent: agentPayload(input.agent),
        ...(auth.organizationID ? { options: { kilocodeOrganizationId: auth.organizationID } } : {}),
      })
      const parsed = WorkspaceCreate.safeParse(body)
      if (!parsed.success) return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace result"))
      if (parsed.data.messageId !== input.messageID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a different message identity"))
      }
      return {
        workspace: yield* workspaceIdentity(parsed.data.workspaceId),
        session: yield* identity(parsed.data.kiloSessionId),
        messageID: input.messageID,
        replayed: parsed.data.replayed === true,
      }
    })

  const startWorkspaceSession = (
    raw: WorkspaceSessionStartInput,
  ): Effect.Effect<WorkspaceSessionStartResult, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceSessionStartInput, raw)
      const auth = yield* resolve(input.organizationID)
      const body = yield* mutation(auth, "createHostedWorkspaceSession", {
        workspaceId: input.id.workspaceID,
        operationKey: input.operationKey,
        clientProvenance: "agent-manager",
        message: { prompt: input.prompt, id: input.messageID },
        agent: agentPayload(input.agent),
        ...(auth.organizationID ? { kilocodeOrganizationId: auth.organizationID } : {}),
      })
      const parsed = WorkspaceCreate.safeParse(body)
      if (!parsed.success) return yield* Effect.fail(invalid("Kilo Cloud returned an unsupported workspace result"))
      if (parsed.data.workspaceId !== input.id.workspaceID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a different workspace identity"))
      }
      if (parsed.data.messageId !== input.messageID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a different message identity"))
      }
      return {
        workspace: { providerID: PROVIDER, workspaceID: parsed.data.workspaceId },
        session: yield* identity(parsed.data.kiloSessionId),
        messageID: input.messageID,
        replayed: parsed.data.replayed === true,
      }
    })

  const unwrap = (value: unknown) =>
    value !== null && typeof value === "object" && "json" in value ? (value as { json: unknown }).json : value

  const listWorkspaceProfiles = (
    raw: WorkspaceProfileListInput = {},
  ): Effect.Effect<WorkspaceProfilePage, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceProfileListInput, raw)
      const auth = yield* resolve(input.organizationID)
      const params = new URLSearchParams()
      params.set(
        "input",
        JSON.stringify(input.organizationID === undefined ? {} : { organizationId: input.organizationID }),
      )
      const response = yield* apiRequest(auth, {
        method: "GET",
        path: `/api/trpc/agentProfiles.list?${params.toString()}`,
        headers: headers(auth),
      })
      const body = yield* consume(response)
      const value = unwrap(yield* data(body))
      const parsed = z.array(CloudProfile).safeParse(value)
      if (!parsed.success) return yield* Effect.fail(invalid("Kilo Cloud returned unsupported profile summaries"))
      return {
        items: parsed.data.map((profile) => ({
          id: profile.id,
          name: profile.name,
          description: profile.description,
          isDefault: profile.isDefault,
        })),
      }
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
        ...buildKiloHeaders(
          undefined,
          auth.organizationID ? { kilocodeOrganizationId: auth.organizationID } : undefined,
        ),
      }
      for (const [key, value] of input.headers.entries()) headers[key] = value
      const query = mapped.query.toString()
      return yield* request(auth, {
        method: mapped.method,
        path: query.length === 0 ? mapped.remote : `${mapped.remote}?${query}`,
        headers,
        ...(input.body && input.body.length > 0 ? { body: new Blob([new Uint8Array(input.body).buffer]) } : {}),
        // Both native event streams are long-lived; every other call keeps the default bound.
        ...(mapped.remote === "/kilo/event" || mapped.remote === "/kilo/cloud-agent/event" ? { timeoutMs: 0 } : {}),
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
    membership,
    listWorkspaces,
    getWorkspace,
    getWorkspaceStatus,
    deleteWorkspace,
    createWorkspace,
    startWorkspaceSession,
    listWorkspaceProfiles,
    route: native,
  }
}

function repositoryPayload(repo: Repository): Record<string, unknown> {
  if (repo.type === "github") return { type: "github", repo: repo.repo, branch: repo.branch }
  if (repo.type === "gitlab") return { type: "gitlab", url: repo.url, branch: repo.branch }
  return { type: "git", url: repo.url, branch: repo.branch }
}

function agentPayload(agent: Agent): Record<string, unknown> {
  return { mode: agent.mode, model: agent.model, ...(agent.variant ? { variant: agent.variant } : {}) }
}

function profilePayload(profile: Profile): Record<string, unknown> {
  return { id: profile.id, ...(profile.overrides ? { overrides: profile.overrides } : {}) }
}

function route(base: `/${string}`, query: URLSearchParams): `/${string}` {
  return query.size === 0 ? base : `${base}?${query.toString()}`
}

function omittedCount(value: string | null) {
  if (value === null || !/^\d+$/.test(value)) return undefined
  const count = Number(value)
  return Number.isSafeInteger(count) ? count : undefined
}
