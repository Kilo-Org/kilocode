import type { GatewayAccount, GatewayContext, GatewayExtension } from "@kilocode/gateway"
import type { RpcHandlers } from "@opencode-ai/plugin/effect/rpc"
import { Effect } from "effect"
import { CloudRpc } from "./cloud-rpc"
import { createCloudAdapter, type CloudAdapter } from "./cloud/client"
import type { ServiceOrigin } from "./cloud/origin"
import type { StreamTicketClient } from "./cloud/stream-ticket"
import type { StreamAgentEventsOptions } from "./cloud/websocket-stream"

// registerCloud is the GatewayExtension the parent passes to createGatewayPlugin.
// It runs inside the host's plugin scope: the account Effect resolves the active
// credential/profile/selection in-host, so the bearer token never crosses the
// public RPC boundary. The parent supplies the Cloud Agent service origin and the
// web-app origin separately; this module never derives either from token metadata
// and never reads an environment variable.
export interface CloudServiceOrigins {
  readonly agentOrigin: ServiceOrigin
  readonly webAppOrigin: ServiceOrigin
}

// Optional seams for local fixtures. allowHttpLoopback is forwarded to the
// adapter's origin guard and is never inferred from ambient environment; it is
// set only by an explicit test/launch option. fetch/WebSocket/ticketClient/stream
// let a fixture substitute the network and socket without a live endpoint.
export interface CloudRegistrationOptions {
  readonly allowHttpLoopback?: boolean
  readonly fetch?: typeof globalThis.fetch
  readonly WebSocket?: typeof WebSocket | undefined
  readonly ticketClient?: (options: { readonly origin: ServiceOrigin; readonly apiKey: string }) => StreamTicketClient
  readonly stream?: (options: StreamAgentEventsOptions) => Promise<void>
}

// The gateway's AccountFailure is a structural {type,message} union; it is not
// exported, so the account Effect is typed against the widened structural shape
// the GatewayExtension contract actually passes.
type Account = Effect.Effect<GatewayAccount, { readonly type: string; readonly message: string }>

// The RPC framework validates each input once against the canonical zod wire
// schemas at the CloudRpc.Definition boundary, so handlers receive decoded,
// typed values. Validation failures surface as the framework's rpc.invalid_input
// system error; handler-side failures surface as a fixed generic message so a
// schema or upstream API error (which can embed prompt or repository-token
// text) never crosses the boundary.
export function registerCloud(origins: CloudServiceOrigins, options: CloudRegistrationOptions = {}): GatewayExtension {
  return (ctx, account) => register(ctx, account, origins, options)
}

const register = Effect.fn(function* (
  ctx: GatewayContext,
  account: Account,
  origins: CloudServiceOrigins,
  options: CloudRegistrationOptions,
) {
  const connect = (resolved: GatewayAccount): CloudAdapter =>
    createCloudAdapter(
      {
        token: resolved.token,
        agentOrigin: origins.agentOrigin,
        webAppOrigin: origins.webAppOrigin,
        ...(resolved.organizationID === null ? {} : { organizationId: resolved.organizationID }),
      },
      {
        ...(options.allowHttpLoopback === undefined ? {} : { allowHttpLoopback: options.allowHttpLoopback }),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(options.WebSocket === undefined ? {} : { WebSocket: options.WebSocket }),
        ...(options.ticketClient === undefined ? {} : { ticketClient: options.ticketClient }),
        ...(options.stream === undefined ? {} : { stream: options.stream }),
      },
    )

  const handlers = {
    start: (input, call) =>
      Effect.gen(function* () {
        const resolved = yield* account.pipe(
          Effect.mapError(() => call.error("kilocode.cloud_unavailable", UNAVAILABLE)),
        )
        const adapter = connect(resolved)
        return yield* Effect.tryPromise({
          try: () =>
            adapter.start({
              message: { prompt: input.message.prompt },
              agent: input.agent,
              repository: input.repository,
              options: {
                createdOnPlatform: "kilo-cli",
                ...(resolved.organizationID === null ? {} : { kilocodeOrganizationId: resolved.organizationID }),
              },
            }),
          catch: () => call.error("kilocode.cloud", FAILED),
        })
      }),
    send: (input, call) =>
      Effect.gen(function* () {
        const resolved = yield* account.pipe(
          Effect.mapError(() => call.error("kilocode.cloud_unavailable", UNAVAILABLE)),
        )
        const adapter = connect(resolved)
        return yield* Effect.tryPromise({
          try: () =>
            adapter.send({
              cloudAgentSessionId: input.cloudAgentSessionId,
              message: { prompt: input.message.prompt },
            }),
          catch: () => call.error("kilocode.cloud", FAILED),
        })
      }),
    status: (input, call) =>
      Effect.gen(function* () {
        const resolved = yield* account.pipe(
          Effect.mapError(() => call.error("kilocode.cloud_unavailable", UNAVAILABLE)),
        )
        const adapter = connect(resolved)
        const status = yield* Effect.tryPromise({
          try: () => adapter.status({ cloudAgentSessionId: input.cloudAgentSessionId, messageId: input.messageId }),
          catch: () => call.error("kilocode.cloud", FAILED),
        })
        return { ...status }
      }),
    result: (input, call) =>
      Effect.gen(function* () {
        const resolved = yield* account.pipe(
          Effect.mapError(() => call.error("kilocode.cloud_unavailable", UNAVAILABLE)),
        )
        const adapter = connect(resolved)
        const { result } = yield* Effect.tryPromise({
          try: () => adapter.result({ cloudAgentSessionId: input.cloudAgentSessionId, messageId: input.messageId }),
          catch: () => call.error("kilocode.cloud", FAILED),
        })
        return result
      }),
    // stream.prepare resolves and validates the WebSocket target under the
    // current account; it never returns the account bearer token, only the
    // validated origin and (provided or ticket-derived) stream URL.
    "stream.prepare": (input, call) =>
      Effect.gen(function* () {
        const resolved = yield* account.pipe(
          Effect.mapError(() => call.error("kilocode.cloud_unavailable", UNAVAILABLE)),
        )
        const adapter = connect(resolved)
        return yield* Effect.tryPromise({
          try: () =>
            adapter.prepare({
              cloudAgentSessionId: input.cloudAgentSessionId,
              ...(input.streamUrl === undefined ? {} : { streamUrl: input.streamUrl }),
            }),
          catch: () => call.error("kilocode.cloud", FAILED),
        })
      }),
  } satisfies RpcHandlers<typeof CloudRpc.Definition>

  yield* ctx.rpc.register(CloudRpc.Definition, handlers)
})

const UNAVAILABLE = "Cloud account is unavailable"
const FAILED = "Cloud Agent request failed"
