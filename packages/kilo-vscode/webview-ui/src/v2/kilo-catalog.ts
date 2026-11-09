// The failure reason of the Kilo Gateway catalog: the `kilocode.gateway` RPC reports it with `catalog.status` and
// publishes each change as its `catalog` event. The chat model pickers show it when no model is left. The Settings
// panel does not read it, because its Kilo row already reports the connection state from the integration data.
import type { OpenCodeClient } from "@opencode/client"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"

type Failure = KiloGatewayRpc.CatalogFailure

export const catalogEvent = `rpc.${KiloGatewayRpc.Definition.id}.catalog` as const

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
 * Reads the reason on each connection and again on each `catalog` event. Only the latest read writes, so a slow
 * answer for an earlier state cannot replace a newer one. A server without the method reports no reason. The
 * directory is an accessor because one connection serves every directory of the Agent Manager.
 */
export function createKiloCatalog(input: {
  api: OpenCodeClient
  directory: Accessor<string | undefined>
  status: Accessor<string>
  on: (type: typeof catalogEvent, handler: () => void) => () => void
}): Accessor<Failure | undefined> {
  const rpc = input.api.rpc(KiloGatewayRpc.Definition)
  const [failure, setFailure] = createSignal<Failure>()
  const state = { read: 0 }
  const refresh = () => {
    const directory = input.directory()
    if (!directory) return
    const read = ++state.read
    void rpc["catalog.status"]({}, { location: { directory } }).then(
      (result) => read === state.read && setFailure(result.failure ?? undefined),
      () => read === state.read && setFailure(undefined),
    )
  }
  createEffect(
    on(
      () => [input.status(), input.directory()] as const,
      ([status, directory]) => status === "connected" && directory && refresh(),
    ),
  )
  onCleanup(input.on(catalogEvent, refresh))
  return failure
}
