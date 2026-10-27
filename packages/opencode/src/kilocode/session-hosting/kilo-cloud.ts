import { Auth } from "@/auth"
import { CloudAuth } from "@/kilocode/cloud/auth"
import { AgentStartRequestSchema, AgentStartResponseSchema } from "@/kilocode/cloud/contracts"
import { createBearerHttpClient, type BearerRequest } from "@/kilocode/cloud/http"
import { createMessageId } from "@/kilocode/cloud/message-id"
import { resolveCloudAgentOrigin, resolveKiloApiOrigin } from "@/kilocode/cloud/origin"
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
  HostedWorkspaceID,
  HostedWorkspaceSessionID,
  ListInput,
  ProviderID,
  StartInput,
  TranscriptInput,
  Workspace,
  WorkspaceListInput,
  WorkspacePage,
  WorkspaceProfile,
  WorkspaceProfileInput,
  WorkspaceSession,
  WorkspaceSessionAttachInput,
  WorkspaceSessionCreateInput,
  WorkspaceSessionRef,
  WorkspaceStatus,
  WorkspaceStatusInput,
  type WorkspaceAttachment,
  WorkspaceCreateInput,
  WorkspaceGetInput,
  WorkspaceSessionListInput,
  type Attachment,
  type Availability,
  type HostedSession,
  type HostedSessionPage,
  type HostedTranscriptPage,
  type NativeRequest,
  type Provider,
  type StartResult,
  type Transport,
  type WorkspaceCreateResult,
  type WorkspaceDeleteResult,
  type WorkspaceSessionCreateResult,
  type WorkspaceSessionPage,
  type WorkspaceProfilePage,
} from "./types"
import { classify } from "./native-routes"

export const PROVIDER = Schema.decodeUnknownSync(ProviderID)("kilo-cloud")
export const ATTACHMENT_TTL_MS = 60_000

const StartEnvelope = z.object({ result: z.object({ data: z.unknown() }) })
const QueryEnvelope = z.object({ result: z.object({ data: z.unknown() }) })

const CloudWorkspaceSession = z.object({
  kiloSessionId: z.string().min(1),
  cloudAgentSessionId: z.string().min(1),
  workspaceId: z.string().min(1).nullable(),
  organizationId: z.string().nullable(),
  title: z.string().nullable(),
  profileId: z.string().nullable(),
  created: z.number(),
  updated: z.number(),
})

const CloudWorkspace = z.object({
  workspaceId: z.string().min(1),
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
  sessions: z.array(CloudWorkspaceSession),
  nextSessionCursor: z.string().nullable(),
})

const CloudWorkspacePage = z.object({
  items: z.array(CloudWorkspace),
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

const CloudWorkspaceCreate = z.object({
  workspaceId: z.string().min(1),
  cloudAgentSessionId: z.string().min(1),
  kiloSessionId: z.string().min(1),
  messageId: z.string().min(1),
  replayed: z.boolean().optional(),
})

const CloudWorkspaceDelete = z.object({
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

  const apiOrigin = Effect.try({
    try: () => resolveKiloApiOrigin(env),
    catch: () => new HostedFailure({ code: "rejected", message: "Kilo API base address is invalid", retryable: false }),
  })

  const send = (base: string, auth: CloudAuth.Resolved, req: BearerRequest) =>
    Effect.tryPromise({
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

  const request = (auth: CloudAuth.Resolved, req: BearerRequest) =>
    Effect.gen(function* () {
      const base = yield* origin
      const response = yield* send(base, auth, req)
      reachable()
      return response
    })

  const apiRequest = (auth: CloudAuth.Resolved, req: BearerRequest) =>
    Effect.gen(function* () {
      const base = yield* apiOrigin
      const response = yield* send(base, auth, req)
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
      return new HostedFailure({ code: "not_found", message: "Kilo Cloud resource was not found", retryable: false })
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

  const query = (auth: CloudAuth.Resolved, procedure: string, input?: unknown) => {
    const params = new URLSearchParams()
    if (input !== undefined) params.set("input", JSON.stringify(input))
    return request(auth, {
      method: "GET",
      path: `/trpc/${procedure}${params.size === 0 ? "" : `?${params.toString()}`}`,
      headers: headers(auth),
    })
  }

  const mutation = (auth: CloudAuth.Resolved, procedure: string, input: unknown) =>
    request(auth, {
      method: "POST",
      path: `/trpc/${procedure}`,
      headers: { ...headers(auth), "content-type": "application/json" },
      body: JSON.stringify(input),
    })

  const cloud = <T>(schema: z.ZodType<T>, value: unknown, message: string) =>
    Effect.try({
      try: () => schema.parse(value) as T,
      catch: () => new HostedFailure({ code: "invalid_response", message, retryable: false }),
    })

  const unwrap = (value: unknown) => {
    if (value === null || typeof value !== "object") return value
    const record: Record<string, unknown> = Object.fromEntries(Object.entries(value))
    return "json" in record ? record.json : value
  }

  const read = (response: Response) =>
    Effect.gen(function* () {
      const body = yield* consume(response)
      if (body === null || typeof body !== "object") return unwrap(body)
      const record: Record<string, unknown> = Object.fromEntries(Object.entries(body))
      const result = record.result
      if (result !== null && typeof result === "object") {
        const envelope: Record<string, unknown> = Object.fromEntries(Object.entries(result))
        if ("data" in envelope) return unwrap(envelope.data)
      }
      return unwrap(body)
    })

  const workspaceIdentity = (workspaceID: string) =>
    decode(HostedWorkspaceID, { providerID: PROVIDER, workspaceID }, "Kilo Cloud returned an unsupported workspace identity")

  const sessionIdentity = (workspaceID: string, cloudAgentSessionID: string, kiloSessionID: string) =>
    decode(
      HostedWorkspaceSessionID,
      {
        providerID: PROVIDER,
        workspaceID,
        remoteSessionID: cloudAgentSessionID,
        nativeSessionID: kiloSessionID,
      },
      "Kilo Cloud returned an unsupported workspace session identity",
    )

  const workspaceSession = (workspaceID: string, value: z.infer<typeof CloudWorkspaceSession>) =>
    Effect.gen(function* () {
      if (value.workspaceId !== null && value.workspaceId !== workspaceID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a session for a different workspace"))
      }
      const id = yield* sessionIdentity(workspaceID, value.cloudAgentSessionId, value.kiloSessionId)
      return {
        id,
        title: value.title,
        organizationID: value.organizationId,
        profileID: value.profileId,
        created: value.created,
        updated: value.updated,
      } satisfies WorkspaceSession
    })

  const workspace = (value: z.infer<typeof CloudWorkspace>) =>
    Effect.gen(function* () {
      const id = yield* workspaceIdentity(value.workspaceId)
      const sessions = yield* Effect.forEach(value.sessions, (session) => workspaceSession(value.workspaceId, session))
      return {
        id,
        name: value.name,
        repository: {
          type: value.repositoryProvider,
          url: value.gitUrl,
          branch: value.gitBranch,
        },
        profileID: value.profileId,
        organizationID: value.organizationId,
        deletionState: value.deletionState,
        created: value.created,
        updated: value.updated,
        lastActivity: value.lastActivity,
        sessions,
        nextSessionCursor: value.nextSessionCursor,
      } satisfies Workspace
    })

  const workspaceList = (raw: WorkspaceListInput = {}): Effect.Effect<WorkspacePage, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceListInput, raw)
      const auth = yield* resolve(input.organizationID)
      const response = yield* query(auth, "listHostedWorkspaces", {
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.sessionLimit === undefined ? {} : { sessionLimit: input.sessionLimit }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.repositoryUrl === undefined ? {} : { repositoryUrl: input.repositoryUrl }),
      })
      const page = yield* cloud(
        CloudWorkspacePage,
        yield* read(response),
        "Kilo Cloud returned an unsupported workspace page",
      )
      const items = yield* Effect.forEach(page.items, workspace)
      return { items, nextCursor: page.nextCursor }
    })

  const workspaceGet = (raw: WorkspaceGetInput): Effect.Effect<Workspace, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceGetInput, raw)
      if (input.id.providerID !== PROVIDER) return yield* Effect.fail(invalid("Unknown session host provider"))
      const auth = yield* resolve(input.organizationID)
      const response = yield* query(auth, "getHostedWorkspace", {
        workspaceId: input.id.workspaceID,
        ...(input.sessionLimit === undefined ? {} : { sessionLimit: input.sessionLimit }),
        ...(input.sessionCursor === undefined ? {} : { sessionCursor: input.sessionCursor }),
      })
      const body = yield* read(response)
      if (body === null) {
        return yield* Effect.fail(
          new HostedFailure({ code: "not_found", message: "Kilo Cloud workspace was not found", retryable: false }),
        )
      }
      const value = yield* cloud(CloudWorkspace, body, "Kilo Cloud returned an unsupported workspace")
      if (value.workspaceId !== input.id.workspaceID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a different workspace identity"))
      }
      return yield* workspace(value)
    })

  const workspaceSessions = (raw: WorkspaceSessionListInput): Effect.Effect<WorkspaceSessionPage, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceSessionListInput, raw)
      const value = yield* workspaceGet({
        id: input.id,
        ...(input.limit === undefined ? {} : { sessionLimit: input.limit }),
        ...(input.cursor === undefined ? {} : { sessionCursor: input.cursor }),
        ...(input.organizationID === undefined ? {} : { organizationID: input.organizationID }),
      })
      return { items: value.sessions, nextCursor: value.nextSessionCursor }
    })

  const workspaceStatus = (raw: WorkspaceStatusInput): Effect.Effect<WorkspaceStatus, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceStatusInput, raw)
      if (input.id.providerID !== PROVIDER) return yield* Effect.fail(invalid("Unknown session host provider"))
      const auth = yield* resolve(input.organizationID)
      const response = yield* query(auth, "getHostedWorkspaceStatus", {
        workspaceId: input.id.workspaceID,
        ...(input.organizationID === undefined ? {} : { kilocodeOrganizationId: input.organizationID }),
      })
      const value = yield* cloud(
        CloudWorkspaceStatus,
        yield* read(response),
        "Kilo Cloud returned an unsupported workspace status",
      )
      if (value.workspaceId !== input.id.workspaceID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a status for a different workspace"))
      }
      const id = yield* workspaceIdentity(value.workspaceId)
      return {
        id,
        deletionState: value.deletionState,
        observedAt: value.observedAt,
        compute: {
          status: value.compute.status,
          detailCode: value.compute.detailCode,
          observedAt: value.compute.observedAt,
          estimatedSleepAt: value.compute.estimatedSleepAt,
        },
        activity: {
          activeSessionCount: value.activity.activeSessionCount,
          hasActiveTurn: value.activity.hasActiveTurn,
        },
        wakeOnInput: {
          available: value.wakeOnInput.available,
          blockedReason: value.wakeOnInput.blockedReason,
        },
        billing: {
          payer: value.billing.payer?.type ?? null,
          sku: value.billing.sku,
          blocked: value.billing.blocked,
          enforcementRequested: value.billing.enforcementRequested,
          intervalStartedAt: value.billing.intervalStartedAt,
          rate: value.billing.rate,
        },
        deletion: {
          started: value.deletion.started,
          completed: value.deletion.completed,
          startedAt: value.deletion.startedAt,
          phase: value.deletion.phase,
          sessionCount: value.deletion.sessionCount,
          runtimeLocationCount: value.deletion.runtimeLocationCount,
          completedRuntimeLocationCount: value.deletion.completedRuntimeLocationCount,
          remainingRuntimeLocationCount: value.deletion.remainingRuntimeLocationCount,
          deletedSessionIDs: value.deletion.deletedSessionIds,
        },
      } satisfies WorkspaceStatus
    })

  const createPayload = (input: WorkspaceCreateInput, messageID: string) => ({
    operationKey: input.operationKey,
    clientProvenance: "agent-manager",
    repository:
      input.repository.type === "github"
        ? {
            type: "github",
            repo: input.repository.repo,
            ...(input.repository.branch === undefined ? {} : { branch: input.repository.branch }),
          }
        : {
            type: input.repository.type,
            url: input.repository.url,
            ...(input.repository.branch === undefined ? {} : { branch: input.repository.branch }),
          },
    profile: { id: input.profileID },
    message: { prompt: input.prompt, id: messageID },
    agent: {
      mode: input.agent.mode,
      model: input.agent.model,
      ...(input.agent.variant === undefined ? {} : { variant: input.agent.variant }),
    },
    ...(input.organizationID === undefined
      ? {}
      : { options: { kilocodeOrganizationId: input.organizationID } }),
  })

  const workspaceCreate = (raw: WorkspaceCreateInput): Effect.Effect<WorkspaceCreateResult, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceCreateInput, raw)
      const auth = yield* resolve(input.organizationID)
      const response = yield* mutation(auth, "createHostedWorkspace", createPayload(input, input.messageID))
      const value = yield* cloud(
        CloudWorkspaceCreate,
        yield* read(response),
        "Kilo Cloud returned an unsupported workspace creation result",
      )
      const workspace = yield* workspaceIdentity(value.workspaceId)
      const session = yield* sessionIdentity(value.workspaceId, value.cloudAgentSessionId, value.kiloSessionId)
      return {
        workspace,
        session,
        messageID: value.messageId,
        replayed: value.replayed === true,
      }
    })

  const workspaceSessionCreate = (
    raw: WorkspaceSessionCreateInput,
  ): Effect.Effect<WorkspaceSessionCreateResult, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceSessionCreateInput, raw)
      if (input.id.providerID !== PROVIDER) return yield* Effect.fail(invalid("Unknown session host provider"))
      const auth = yield* resolve(input.organizationID)
      const response = yield* mutation(auth, "createHostedWorkspaceSession", {
        workspaceId: input.id.workspaceID,
        operationKey: input.operationKey,
        clientProvenance: "agent-manager",
        message: { prompt: input.prompt, id: input.messageID },
        agent: {
          mode: input.agent.mode,
          model: input.agent.model,
          ...(input.agent.variant === undefined ? {} : { variant: input.agent.variant }),
        },
        ...(input.organizationID === undefined ? {} : { kilocodeOrganizationId: input.organizationID }),
      })
      const value = yield* cloud(
        CloudWorkspaceCreate,
        yield* read(response),
        "Kilo Cloud returned an unsupported workspace session result",
      )
      if (value.workspaceId !== input.id.workspaceID) {
        return yield* Effect.fail(invalid("Kilo Cloud returned a session for a different workspace"))
      }
      const session = yield* sessionIdentity(value.workspaceId, value.cloudAgentSessionId, value.kiloSessionId)
      return {
        workspace: input.id,
        session,
        messageID: value.messageId,
        replayed: value.replayed === true,
      }
    })

  const workspaceDelete = (raw: WorkspaceGetInput): Effect.Effect<WorkspaceDeleteResult, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceGetInput, raw)
      if (input.id.providerID !== PROVIDER) return yield* Effect.fail(invalid("Unknown session host provider"))
      const auth = yield* resolve(input.organizationID)
      const response = yield* mutation(auth, "deleteWorktree", {
        worktreeId: input.id.workspaceID,
        ...(input.organizationID === undefined ? {} : { kilocodeOrganizationId: input.organizationID }),
      })
      const value = yield* cloud(
        CloudWorkspaceDelete,
        yield* read(response),
        "Kilo Cloud returned an unsupported workspace deletion result",
      )
      return {
        workspace: input.id,
        success: true,
        deletedSessionIDs: value.deletedSessionIds,
      }
    })

  const findWorkspaceSession = (auth: CloudAuth.Resolved, id: WorkspaceSessionRef) =>
    Effect.gen(function* () {
      let cursor: string | undefined
      for (let page = 0; page < 10; page++) {
        const response = yield* query(auth, "getHostedWorkspace", {
          workspaceId: id.workspaceID,
          sessionLimit: 100,
          ...(cursor === undefined ? {} : { sessionCursor: cursor }),
        })
        const body = yield* read(response)
        if (body === null) {
          return yield* Effect.fail(
            new HostedFailure({ code: "not_found", message: "Kilo Cloud workspace was not found", retryable: false }),
          )
        }
        const value = yield* cloud(CloudWorkspace, body, "Kilo Cloud returned an unsupported workspace")
        for (const session of value.sessions) {
          if (session.cloudAgentSessionId !== id.remoteSessionID) continue
          return yield* workspaceSession(value.workspaceId, session)
        }
        if (value.nextSessionCursor === null) break
        cursor = value.nextSessionCursor
      }
      return yield* Effect.fail(
        new HostedFailure({ code: "not_found", message: "Kilo Cloud workspace session was not found", retryable: false }),
      )
    })

  const workspaceAttach = (raw: WorkspaceSessionAttachInput): Effect.Effect<WorkspaceAttachment, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceSessionAttachInput, raw)
      if (input.id.providerID !== PROVIDER) return yield* Effect.fail(invalid("Unknown session host provider"))
      const auth = yield* resolve(input.organizationID)
      const session = yield* findWorkspaceSession(auth, input.id)
      return {
        session: session.id,
        expiresAt: clock() + ATTACHMENT_TTL_MS,
      }
    })

  const workspaceProfiles = (raw: WorkspaceProfileInput = {}): Effect.Effect<WorkspaceProfilePage, HostedFailure> =>
    Effect.gen(function* () {
      const input = yield* check(WorkspaceProfileInput, raw)
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
      const value = yield* cloud(
        z.array(CloudProfile),
        yield* read(response),
        "Kilo Cloud returned unsupported profile summaries",
      )
      return {
        items: value.map(
          (profile): WorkspaceProfile => ({
            id: profile.id,
            name: profile.name,
            description: profile.description,
            isDefault: profile.isDefault,
          }),
        ),
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
    workspace: {
      list: workspaceList,
      get: workspaceGet,
      status: workspaceStatus,
      sessions: workspaceSessions,
      create: workspaceCreate,
      createSession: workspaceSessionCreate,
      delete: workspaceDelete,
      attach: workspaceAttach,
      profiles: workspaceProfiles,
    },
  }
}

function route(base: `/${string}`, query: URLSearchParams): `/${string}` {
  return query.size === 0 ? base : `${base}?${query.toString()}`
}

function errorCode(value: unknown) {
  if (value === null || typeof value !== "object") return undefined
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  if (typeof record.error === "string") return record.error
  const error = record.error
  if (error === null || typeof error !== "object") return undefined
  const detail: Record<string, unknown> = Object.fromEntries(Object.entries(error))
  if (typeof detail.code === "string") return detail.code
  if (typeof detail.message === "string") return detail.message
  const json = detail.json
  if (json !== null && typeof json === "object") {
    const nested: Record<string, unknown> = Object.fromEntries(Object.entries(json))
    if (typeof nested.message === "string") return nested.message
    const data = nested.data
    if (data !== null && typeof data === "object") {
      const fields: Record<string, unknown> = Object.fromEntries(Object.entries(data))
      if (typeof fields.code === "string") return fields.code
    }
  }
  const data = detail.data
  if (data !== null && typeof data === "object") {
    const fields: Record<string, unknown> = Object.fromEntries(Object.entries(data))
    if (typeof fields.code === "string") return fields.code
  }
  return undefined
}

function omittedCount(value: string | null) {
  if (value === null || !/^\d+$/.test(value)) return undefined
  const count = Number(value)
  return Number.isSafeInteger(count) ? count : undefined
}
