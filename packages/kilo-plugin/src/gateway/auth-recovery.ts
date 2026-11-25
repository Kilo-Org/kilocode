export * as GatewayAuthRecovery from "./auth-recovery.js"

import type { ConnectionInfo } from "@opencode/client"
import { Bus } from "@opencode/core/bus"
import type { IntegrationDomain } from "@opencode/plugin/effect/integration"
import type { IntegrationID } from "@opencode/schema/integration-id"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { Clock, Duration, Effect, Schema, Scope } from "effect"
import { GatewayCatalog } from "./catalog.js"
import { GatewayCoalesce } from "./coalesce.js"

export const VERIFY_COOLDOWN = Duration.seconds(30)

// Published on the global bus (`{ global: true }`) when a Location verifies that the active Kilo token
// was rejected, so other loaded Locations refresh their catalog, authStatus, and connection status too.
export const AuthInvalidatedEvent = Bus.ephemeral({
  type: `rpc.${KiloGatewayRpc.Definition.id}.auth_invalidated`,
  schema: {
    source: Schema.String,
    tokenHash: Schema.String,
  },
})

export interface CatalogSnapshot {
  readonly account?: { readonly token: string }
  readonly statusConnection?: ConnectionInfo
  readonly failed: boolean
  readonly failure?: GatewayCatalog.View["failure"]
  readonly anonymous: boolean
}

export function create(input: {
  readonly integrationID: IntegrationID
  readonly instanceID: string
  readonly integration: IntegrationDomain
  readonly bus: Bus.Interface
  readonly scope: Scope.Scope
  readonly getCatalog: () => CatalogSnapshot
  readonly getEpoch: () => number
  readonly verify: (targetEpoch: number, rejectedToken: string) => Effect.Effect<void>
}) {
  let reportedConnection: ConnectionInfo | undefined
  let verifyInFlight = false
  let lastVerify: { readonly token: string; readonly epoch: number; readonly at: number } | undefined

  const syncConnectionStatus = Effect.gen(function* () {
    const current = input.getCatalog()
    const connection = current.statusConnection
    const next = connection ? GatewayCatalog.connectionStatus(current.failure) : undefined
    // Clear a previously flagged connection when switching away (e.g. re-login adds a new credential while
    // keeping the old one in `integration.connections`, where Settings scans all connections for `status`).
    if (
      reportedConnection &&
      (!connection || GatewayCatalog.connectionKey(reportedConnection) !== GatewayCatalog.connectionKey(connection))
    ) {
      const previous = reportedConnection
      reportedConnection = undefined
      yield* input.integration.connection.status({
        integrationID: input.integrationID,
        connection: previous,
        status: undefined,
      })
    }
    if (!connection) return
    if (next) {
      reportedConnection = connection
      yield* input.integration.connection.status({ integrationID: input.integrationID, connection, status: next })
      return
    }
    if (current.failed) return
    if (
      reportedConnection &&
      GatewayCatalog.connectionKey(reportedConnection) === GatewayCatalog.connectionKey(connection)
    ) {
      reportedConnection = undefined
    }
    yield* input.integration.connection.status({ integrationID: input.integrationID, connection, status: undefined })
  })

  const onUnauthorizedResponse = Effect.fnUntraced(function* (request: Request) {
    const rejectedToken = GatewayCatalog.rejectedActiveToken(request, input.getCatalog())
    if (!rejectedToken || verifyInFlight) return
    const targetEpoch = input.getEpoch()
    const now = yield* Clock.currentTimeMillis
    if (
      lastVerify &&
      lastVerify.token === rejectedToken &&
      lastVerify.epoch === targetEpoch &&
      now - lastVerify.at < Duration.toMillis(VERIFY_COOLDOWN)
    )
      return
    verifyInFlight = true
    lastVerify = { token: rejectedToken, epoch: targetEpoch, at: now }
    yield* input.verify(targetEpoch, rejectedToken).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          verifyInFlight = false
        }),
      ),
      Effect.catch(() => Effect.void),
      Effect.forkIn(input.scope, { startImmediately: true }),
    )
  })

  const notifyInvalidated = (rejectedToken: string) =>
    input.bus.publish(
      AuthInvalidatedEvent,
      { source: input.instanceID, tokenHash: GatewayCoalesce.tokenHash(rejectedToken) },
      { global: true },
    )

  const matchesInvalidation = (event: { readonly source?: unknown; readonly tokenHash?: unknown }) => {
    if (event.source === input.instanceID || typeof event.tokenHash !== "string") return false
    const current = input.getCatalog()
    if (current.anonymous || current.failure?.kind === "unauthorized") return false
    const token = current.account?.token
    if (!token) return false
    return GatewayCoalesce.tokenHash(token) === event.tokenHash
  }

  return {
    syncConnectionStatus,
    onUnauthorizedResponse,
    notifyInvalidated,
    matchesInvalidation,
  }
}
