import { EventV2Bridge } from "@/event-v2-bridge"
import * as Attachments from "@/kilocode/server/hosted-attachments"
import { SessionHost } from "@/kilocode/session-hosting"
import {
  HostedFailure,
  StartInput,
  type OrganizationID,
  type Provider,
  type ProviderID,
  type RemoteSessionID,
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
        .pipe(Effect.catchCause((cause) => Effect.sync(() => log.error("availability event publish failed", { cause }))))

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
      const descriptor = yield* provider
        .attach({
          id: identity(ctx.params),
          ...(organizationID ? { organizationID } : {}),
        })
        .pipe(Effect.mapError(mapFailure))
      const entry = Attachments.store.mint({
        provider,
        session: descriptor.session,
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

    return handlers
      .handle("providers", providers)
      .handle("list", list)
      .handle("start", start)
      .handle("get", get)
      .handle("transcript", transcript)
      .handle("attach", attach)
      .handle("detach", detach)
  }),
)
