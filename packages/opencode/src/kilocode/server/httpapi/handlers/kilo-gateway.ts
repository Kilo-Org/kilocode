import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import type { AudioTranscriptionsBody, EditBody, FimBody } from "../groups/kilo-gateway"

// Relay: the upstream handlers in this file fronted profile / balance /
// notifications / org modes / claw / cloud-sessions / FIM / edit / audio
// transcriptions against api.kilo.ai. Relay doesn't ship any of those as
// a SaaS today — they were Kilo's commercial surface, not generic
// agent-runtime needs.
//
// The HTTP API group still has to be declared (other packages import
// kiloGatewayHandlers and the InstanceHttpApi spec lists every route),
// so we keep the group shape and answer every endpoint with HTTP 503
// "not implemented" via Effect.fail. This:
//   - keeps the typecheck green across the 8+ external importers
//   - guarantees no request can leak to api.kilo.ai or kiloapps.io
//     even if a stale client somehow calls /kilo/* paths
//   - leaves the surface ready to either remove entirely (group + spec)
//     or repurpose for Relay-native endpoints in a later pass.
//
// The actual chat/embedding runtime does NOT go through this group —
// it goes through the provider runtime in packages/kilo-gateway/src/
// provider.ts, which we already pointed at the Relay LiteLLM gateway.

// HTTP 401 Unauthorized: the only error type that every endpoint in this
// group declares in its error set (some accept BadRequest, others
// InvalidRequestError, but all accept Unauthorized). Semantically OK —
// "the route exists but Relay won't authorize you to use it" — and
// crucially does not require this code path to construct a Kilo-flavoured
// payload like profile or balance.
const notImplemented = (_route: string) => Effect.fail(new HttpApiError.Unauthorized())

export const kiloGatewayHandlers = HttpApiBuilder.group(InstanceHttpApi, "kilo", (handlers) =>
  Effect.gen(function* () {
    const profile = Effect.fn("KiloGatewayHttpApi.profile")(function* () {
      return yield* notImplemented("kilo.profile")
    })
    const authStatus = Effect.fn("KiloGatewayHttpApi.authStatus")(function* () {
      return yield* notImplemented("kilo.authStatus")
    })
    const modes = Effect.fn("KiloGatewayHttpApi.modes")(function* () {
      return yield* notImplemented("kilo.modes")
    })
    const fim = Effect.fn("KiloGatewayHttpApi.fim")(function* (_ctx: { payload: typeof FimBody.Type }) {
      return yield* notImplemented("kilo.fim")
    })
    const edit = Effect.fn("KiloGatewayHttpApi.edit")(function* (_ctx: { payload: typeof EditBody.Type }) {
      return yield* notImplemented("kilo.edit")
    })
    const audioTranscriptions = Effect.fn("KiloGatewayHttpApi.audioTranscriptions")(function* (_ctx: {
      payload: typeof AudioTranscriptionsBody.Type
    }) {
      return yield* notImplemented("kilo.audioTranscriptions")
    })
    const notifications = Effect.fn("KiloGatewayHttpApi.notifications")(function* () {
      return yield* notImplemented("kilo.notifications")
    })
    const organization = Effect.fn("KiloGatewayHttpApi.organization")(function* () {
      return yield* notImplemented("kilo.organization")
    })
    const clawStatus = Effect.fn("KiloGatewayHttpApi.clawStatus")(function* () {
      return yield* notImplemented("kilo.clawStatus")
    })
    const clawChatCredentials = Effect.fn("KiloGatewayHttpApi.clawChatCredentials")(function* () {
      return yield* notImplemented("kilo.clawChatCredentials")
    })
    const cloudSessions = Effect.fn("KiloGatewayHttpApi.cloudSessions")(function* () {
      return yield* notImplemented("kilo.cloudSessions")
    })
    const cloudSession = Effect.fn("KiloGatewayHttpApi.cloudSession")(function* () {
      return yield* notImplemented("kilo.cloudSession")
    })
    const cloudSessionImport = Effect.fn("KiloGatewayHttpApi.cloudSessionImport")(function* () {
      return yield* notImplemented("kilo.cloudSessionImport")
    })

    return handlers
      .handle("profile", profile)
      .handle("authStatus", authStatus)
      .handle("modes", modes)
      .handle("fim", fim)
      .handle("edit", edit)
      .handle("audioTranscriptions", audioTranscriptions)
      .handle("notifications", notifications)
      .handle("organization", organization)
      .handle("clawStatus", clawStatus)
      .handle("clawChatCredentials", clawChatCredentials)
      .handle("cloudSessions", cloudSessions)
      .handle("cloudSession", cloudSession)
      .handle("cloudSessionImport", cloudSessionImport)
  }),
)
