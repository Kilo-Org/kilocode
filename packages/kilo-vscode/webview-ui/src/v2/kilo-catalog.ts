// The failure reason of the Kilo Gateway catalog: the `kilocode.gateway` RPC reports it with `catalog.status` and
// publishes each change as its `catalog` event. Settings show it under the Kilo row and in the provider catalog, and
// the model pickers show it when no model is left.
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"

type Failure = KiloGatewayRpc.CatalogFailure

const EVENT = `rpc.${KiloGatewayRpc.Definition.id}.catalog` as const

/** The localized reason, or undefined without a failure. The copy matches the TUI. */
export function failureMessage(t: (key: string, vars?: { status: number }) => string, failure: Failure | undefined) {
  switch (failure?.kind) {
    case undefined:
      return undefined
    case "unauthorized":
      return failure.status
        ? t("provider.failure.unauthorized", { status: failure.status })
        : t("provider.failure.unauthorizedNoStatus")
    case "unauthenticated":
      return t("provider.failure.unauthenticated")
    case "network":
      return t("provider.failure.network")
    case "http":
      return failure.status
        ? t("provider.failure.http", { status: failure.status })
        : t("provider.failure.httpNoStatus")
    case "schema":
      return t("provider.failure.schema")
    case "organization_missing":
      return t("provider.failure.organizationMissing")
    case "scope_conflict":
      return t("provider.failure.scopeConflict")
    case "personal_unavailable":
      return t("provider.failure.personalUnavailable")
  }
}

/** Whether the reason offers the Kilo sign-in action: the credentials are missing or were rejected. */
export function failureNeedsSignIn(failure: Failure) {
  return failure.kind === "unauthorized" || failure.kind === "unauthenticated"
}

/**
 * Reads the reason on each connection and applies the reason each `catalog` event carries. Only the latest read
 * writes, so a slow answer for an earlier state cannot replace a newer one. A server without the method reports no
 * reason.
 */
export function createKiloCatalog(input: {
  api: OpenCodeClient
  directory: string
  status: Accessor<string>
  on: (type: typeof EVENT, handler: (event: OpenCodeEvent) => void) => () => void
}): Accessor<Failure | undefined> {
  const rpc = input.api.rpc(KiloGatewayRpc.Definition)
  const [failure, setFailure] = createSignal<Failure>()
  const state = { read: 0 }
  const refresh = () => {
    const read = ++state.read
    void rpc["catalog.status"]({}, { location: { directory: input.directory } }).then(
      (result) => read === state.read && setFailure(result.failure ?? undefined),
      () => {},
    )
  }
  createEffect(on(input.status, (status) => status === "connected" && refresh()))
  onCleanup(
    input.on(EVENT, (event) => {
      const status = event.data as KiloGatewayRpc.CatalogStatus
      ++state.read
      setFailure(status.failure ?? undefined)
    }),
  )
  return failure
}
