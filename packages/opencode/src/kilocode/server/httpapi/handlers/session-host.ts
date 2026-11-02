import { EventV2Bridge } from "@/event-v2-bridge"
import * as Attachments from "@/kilocode/server/hosted-attachments"
import { SessionHost } from "@/kilocode/session-hosting"
import {
  HostedFailure,
  StartInput,
  deletionDispatched,
  type CreateWorkspaceInput,
  type HostedWorkspaceID,
  type OrganizationID,
  type Provider,
  type ProviderID,
  type RemoteSessionID,
  type WorkspaceID,
  type WorkspaceSessionStartBody,
} from "@/kilocode/session-hosting/types"
import { SessionHostEvent } from "@opencode-ai/schema/kilocode/session-host-event"
import {
  ConflictError,
  InvalidRequestError,
  ServiceUnavailableError,
  UnauthorizedError,
  UpstreamError,
  notFound,
} from "@/server/routes/instance/httpapi/errors"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { SessionHostGoneError, SessionHostPaymentRequiredError } from "../groups/session-host"

const SERVICE = "kilo-cloud"
const log = Log.create({ service: "session-host" })
const hostedDown = {
  state: "unavailable",
  reason: "unreachable",
  message: "Hosted session availability could not be read",
} as const

function mapFailure(error: HostedFailure) {
  switch (error.code) {
    case "signed_out":
    case "unauthorized":
      return new UnauthorizedError({ message: error.message })
    case "payment_required":
      return new SessionHostPaymentRequiredError({ code: error.code, message: error.message })
    case "not_found":
      return notFound(error.message)
    case "invalid_request":
      return new InvalidRequestError({ message: error.message })
    case "rejected":
      return new ConflictError({ message: error.message })
    case "invalid_response":
      return new UpstreamError({ message: error.message, service: SERVICE })
    case "auth_unavailable":
      return new ServiceUnavailableError({ message: error.message, service: SERVICE })
    default:
      return new ServiceUnavailableError({ message: error.message, service: SERVICE })
  }
}

export const sessionHostHandlers = HttpApiBuilder.group(InstanceHttpApi, "session-host", (handlers) =>
  Effect.gen(function* () {
    const host = yield* SessionHost.Service
    const events = yield* EventV2Bridge.Service

    const announce = (entry: Attachments.Entry, state: "available" | "unavailable", reason?: string) =>
      events
        .publish(SessionHostEvent.Availability, {
          providerID: entry.session.providerID,
          sessionID: entry.session.sessionID,
          state,
          ...(reason ? { reason } : {}),
        })
        .pipe(
          Effect.catchCause((cause) => Effect.sync(() => log.error("availability event publish failed", { cause }))),
        )

    const require = (id: ProviderID) => host.registry.require(id).pipe(Effect.mapError(mapFailure))

    const resolveDefault: Effect.Effect<Provider, HostedFailure> = Effect.gen(function* () {
      const provider = host.registry.providers.find((item) => item.default === true)
      if (!provider) {
        return yield* Effect.fail(
          new HostedFailure({
            code: "unknown_provider",
            message: "No default session host provider is registered",
            retryable: false,
          }),
        )
      }
      const availability = yield* provider.availability
      if (availability.state === "available") return provider
      return yield* Effect.fail(
        new HostedFailure({
          code: availability.reason === "signed_out" ? "signed_out" : "unavailable",
          message: availability.message,
          retryable: false,
        }),
      )
    })

    const identity = (params: { providerID: ProviderID; sessionID: RemoteSessionID }) => ({
      providerID: params.providerID,
      sessionID: params.sessionID,
    })

    const workspaceID = (params: { providerID: ProviderID; workspaceID: WorkspaceID }): HostedWorkspaceID => ({
      providerID: params.providerID,
      workspaceID: params.workspaceID,
    })

    const invalidate = <A>(id: HostedWorkspaceID, effect: Effect.Effect<A, HostedFailure>) =>
      effect.pipe(
        Effect.catch((error) => {
          if (error.code === "not_found") Attachments.store.disposeWorkspace(id)
          return Effect.fail(error)
        }),
      )

    const providers = Effect.fn("SessionHostHttpApi.providers")(function* () {
      const items = yield* Effect.forEach(host.registry.providers, (provider) =>
        Effect.gen(function* () {
          return {
            id: provider.id,
            default: provider.default === true,
            // Availability probes credentials and remote state. It must never turn
            // discovery into a server error, so an unexpected effect failure is a
            // reported unavailable state instead.
            availability: yield* provider.availability.pipe(
              Effect.catchCause((cause) =>
                Effect.sync(() => {
                  log.error("provider availability failed", { providerID: provider.id, cause })
                  return hostedDown
                }),
              ),
            ),
            transport: yield* provider.transport,
          }
        }),
      )
      return { providers: items }
    })

    const list = Effect.fn("SessionHostHttpApi.list")(function* (ctx: { query: { limit?: number } }) {
      // An unavailable host is reported, not thrown: this route must stay a local
      // discovery surface even when Cloud cannot be reached.
      const provider = yield* resolveDefault.pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!provider) return { items: [] }
      return yield* provider
        .list(ctx.query.limit === undefined ? {} : { limit: ctx.query.limit })
        .pipe(Effect.mapError(mapFailure))
    })

    const start = Effect.fn("SessionHostHttpApi.start")(function* (ctx: { payload: typeof StartInput.Type }) {
      const provider = yield* resolveDefault.pipe(Effect.mapError(mapFailure))
      return yield* provider.start(ctx.payload).pipe(Effect.mapError(mapFailure))
    })

    const get = Effect.fn("SessionHostHttpApi.get")(function* (ctx: {
      params: { providerID: ProviderID; sessionID: RemoteSessionID }
    }) {
      const provider = yield* require(ctx.params.providerID)
      return yield* provider.get({ id: identity(ctx.params) }).pipe(Effect.mapError(mapFailure))
    })

    const transcript = Effect.fn("SessionHostHttpApi.transcript")(function* (ctx: {
      params: { providerID: ProviderID; sessionID: RemoteSessionID }
      query: { limit?: number; before?: string }
    }) {
      const provider = yield* require(ctx.params.providerID)
      return yield* provider
        .transcript({
          id: identity(ctx.params),
          ...(ctx.query.limit === undefined ? {} : { limit: ctx.query.limit }),
          ...(ctx.query.before === undefined ? {} : { before: ctx.query.before }),
        })
        .pipe(Effect.mapError(mapFailure))
    })

    const attach = Effect.fn("SessionHostHttpApi.attach")(function* (ctx: {
      params: { providerID: ProviderID; sessionID: RemoteSessionID }
      query: { organizationID?: OrganizationID }
    }) {
      const provider = yield* require(ctx.params.providerID)
      const organizationID = ctx.query.organizationID
      const input = {
        id: identity(ctx.params),
        ...(organizationID ? { organizationID } : {}),
      }
      const descriptor = yield* provider.attach(input).pipe(Effect.mapError(mapFailure))
      const workspace = provider.membership
        ? yield* provider.membership(input).pipe(Effect.mapError(mapFailure))
        : undefined
      const entry = Attachments.store.mint({
        provider,
        session: descriptor.session,
        ...(workspace ? { workspace } : {}),
        ...(organizationID ? { organizationID } : {}),
        expiresAt: descriptor.expiresAt,
      })
      yield* announce(entry, "available")
      return { attachmentID: entry.id, session: entry.session, expiresAt: entry.expiresAt }
    })

    const detach = Effect.fn("SessionHostHttpApi.detach")(function* (ctx: { params: { attachmentID: string } }) {
      const found = Attachments.store.lookup(ctx.params.attachmentID)
      if (found.kind === "unknown") return yield* Effect.fail(notFound("Session attachment was not found"))
      if (found.kind === "expired") {
        return yield* Effect.fail(
          new SessionHostGoneError({ code: "expired", message: "Session attachment has expired" }),
        )
      }
      if (found.kind === "disposed") {
        return yield* Effect.fail(
          new SessionHostGoneError({ code: "disposed", message: "Session attachment was disposed" }),
        )
      }
      Attachments.store.dispose(ctx.params.attachmentID)
      if (Attachments.store.count(found.entry.session) === 0) {
        yield* announce(found.entry, "unavailable", "detached")
      }
      return { detached: true }
    })

    const listWorkspaces = Effect.fn("SessionHostHttpApi.listWorkspaces")(function* (ctx: {
      query: {
        limit?: number
        sessionLimit?: number
        cursor?: string
        repositoryUrl?: string
        organizationID?: OrganizationID
      }
    }) {
      const provider = yield* resolveDefault.pipe(Effect.mapError(mapFailure))
      return yield* provider
        .listWorkspaces({
          ...(ctx.query.limit === undefined ? {} : { limit: ctx.query.limit }),
          ...(ctx.query.sessionLimit === undefined ? {} : { sessionLimit: ctx.query.sessionLimit }),
          ...(ctx.query.cursor === undefined ? {} : { cursor: ctx.query.cursor }),
          ...(ctx.query.repositoryUrl === undefined ? {} : { repositoryUrl: ctx.query.repositoryUrl }),
          ...(ctx.query.organizationID === undefined ? {} : { organizationID: ctx.query.organizationID }),
        })
        .pipe(Effect.mapError(mapFailure))
    })

    const listWorkspaceProfiles = Effect.fn("SessionHostHttpApi.listWorkspaceProfiles")(function* (ctx: {
      query: { organizationID?: OrganizationID }
    }) {
      const provider = yield* resolveDefault.pipe(Effect.mapError(mapFailure))
      return yield* provider
        .listWorkspaceProfiles(
          ctx.query.organizationID === undefined ? {} : { organizationID: ctx.query.organizationID },
        )
        .pipe(Effect.mapError(mapFailure))
    })

    const createWorkspace = Effect.fn("SessionHostHttpApi.createWorkspace")(function* (ctx: {
      payload: CreateWorkspaceInput
    }) {
      const provider = yield* resolveDefault.pipe(Effect.mapError(mapFailure))
      return yield* provider.createWorkspace(ctx.payload).pipe(Effect.mapError(mapFailure))
    })

    const getWorkspace = Effect.fn("SessionHostHttpApi.getWorkspace")(function* (ctx: {
      params: { providerID: ProviderID; workspaceID: WorkspaceID }
      query: { sessionLimit?: number; sessionCursor?: string; organizationID?: OrganizationID }
    }) {
      const provider = yield* require(ctx.params.providerID)
      return yield* invalidate(
        workspaceID(ctx.params),
        provider.getWorkspace({
          id: { providerID: ctx.params.providerID, workspaceID: ctx.params.workspaceID },
          ...(ctx.query.sessionLimit === undefined ? {} : { sessionLimit: ctx.query.sessionLimit }),
          ...(ctx.query.sessionCursor === undefined ? {} : { sessionCursor: ctx.query.sessionCursor }),
          ...(ctx.query.organizationID === undefined ? {} : { organizationID: ctx.query.organizationID }),
        }),
      ).pipe(Effect.mapError(mapFailure))
    })

    const getWorkspaceStatus = Effect.fn("SessionHostHttpApi.getWorkspaceStatus")(function* (ctx: {
      params: { providerID: ProviderID; workspaceID: WorkspaceID }
      query: { organizationID?: OrganizationID }
    }) {
      const provider = yield* require(ctx.params.providerID)
      return yield* invalidate(
        workspaceID(ctx.params),
        provider.getWorkspaceStatus({
          id: { providerID: ctx.params.providerID, workspaceID: ctx.params.workspaceID },
          ...(ctx.query.organizationID === undefined ? {} : { organizationID: ctx.query.organizationID }),
        }),
      ).pipe(Effect.mapError(mapFailure))
    })

    const listWorkspaceSessions = Effect.fn("SessionHostHttpApi.listWorkspaceSessions")(function* (ctx: {
      params: { providerID: ProviderID; workspaceID: WorkspaceID }
      query: { limit?: number; cursor?: string; organizationID?: OrganizationID }
    }) {
      const provider = yield* require(ctx.params.providerID)
      const workspace = yield* invalidate(
        workspaceID(ctx.params),
        provider.getWorkspace({
          id: { providerID: ctx.params.providerID, workspaceID: ctx.params.workspaceID },
          ...(ctx.query.limit === undefined ? {} : { sessionLimit: ctx.query.limit }),
          ...(ctx.query.cursor === undefined ? {} : { sessionCursor: ctx.query.cursor }),
          ...(ctx.query.organizationID === undefined ? {} : { organizationID: ctx.query.organizationID }),
        }),
      ).pipe(Effect.mapError(mapFailure))
      return {
        items: workspace.sessions,
        ...(workspace.cursor === undefined ? {} : { cursor: workspace.cursor }),
      }
    })

    const deleteWorkspace = Effect.fn("SessionHostHttpApi.deleteWorkspace")(function* (ctx: {
      params: { providerID: ProviderID; workspaceID: WorkspaceID }
      query: { organizationID?: OrganizationID }
    }) {
      const provider = yield* require(ctx.params.providerID)
      const id = workspaceID(ctx.params)
      const result = yield* provider
        .deleteWorkspace({
          id,
          ...(ctx.query.organizationID === undefined ? {} : { organizationID: ctx.query.organizationID }),
        })
        .pipe(
          Effect.catch((error) => {
            if (error.code === "not_found" || deletionDispatched(error)) {
              Attachments.store.disposeWorkspace(id)
            }
            return Effect.fail(error)
          }),
          Effect.mapError(mapFailure),
        )
      Attachments.store.disposeWorkspace(id)
      return result
    })

    const startWorkspaceSession = Effect.fn("SessionHostHttpApi.startWorkspaceSession")(function* (ctx: {
      params: { providerID: ProviderID; workspaceID: WorkspaceID }
      payload: WorkspaceSessionStartBody
    }) {
      const provider = yield* require(ctx.params.providerID)
      return yield* provider
        .startWorkspaceSession({
          id: { providerID: ctx.params.providerID, workspaceID: ctx.params.workspaceID },
          ...ctx.payload,
        })
        .pipe(Effect.mapError(mapFailure))
    })

    return handlers
      .handle("providers", providers)
      .handle("list", list)
      .handle("start", start)
      .handle("get", get)
      .handle("transcript", transcript)
      .handle("attach", attach)
      .handle("detach", detach)
      .handle("listWorkspaces", listWorkspaces)
      .handle("listWorkspaceProfiles", listWorkspaceProfiles)
      .handle("createWorkspace", createWorkspace)
      .handle("getWorkspace", getWorkspace)
      .handle("getWorkspaceStatus", getWorkspaceStatus)
      .handle("listWorkspaceSessions", listWorkspaceSessions)
      .handle("deleteWorkspace", deleteWorkspace)
      .handle("startWorkspaceSession", startWorkspaceSession)
  }),
)
