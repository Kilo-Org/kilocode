// The failure reason of the Kilo Gateway catalog: the `kilocode.gateway` RPC reports it with `catalog.status` and
// publishes each change as its `catalog` event. The chat model pickers show it when no model is left. The Settings
// panel does not read it, because its Kilo row already reports the connection state from the integration data.
import type { OpenCodeClient } from "@opencode/client"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import type { Failure } from "./error"

type CatalogFailure = KiloGatewayRpc.CatalogFailure

export const catalogEvent = `rpc.${KiloGatewayRpc.Definition.id}.catalog` as const

/** The localized reason, or undefined without a failure. The copy matches the TUI. */
export function failureMessage(
  t: (key: string, vars?: { status: number }) => string,
  failure: CatalogFailure | undefined,
) {
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
export function failureNeedsSignIn(failure: CatalogFailure) {
  return failure.kind === "unauthorized" || failure.kind === "unauthenticated"
}

/** Returns `onSignIn` only when `failure` can be resolved by signing in again. */
export function signInAction(failure: CatalogFailure | undefined, onSignIn: () => void) {
  return failure && failureNeedsSignIn(failure) ? onSignIn : undefined
}

/**
 * Converts an auth-related Kilo Gateway catalog failure into a chat banner failure so the composer can show the
 * reason with a Sign-In action. Returns undefined when there is no failure or sign-in would not resolve it.
 */
export function catalogAuthFailure(failure: CatalogFailure | undefined): Failure | undefined {
  if (!failure || !failureNeedsSignIn(failure)) return undefined
  if (failure.kind === "unauthenticated") {
    return { key: "provider.failure.unauthenticated", message: "Not signed in.", auth: true }
  }
  if (failure.status) {
    return {
      key: "provider.failure.unauthorized",
      message: `Credentials rejected (HTTP ${failure.status}). Sign in again.`,
      params: { status: failure.status },
      auth: true,
    }
  }
  return {
    key: "provider.failure.unauthorizedNoStatus",
    message: "Credentials rejected. Sign in again.",
    auth: true,
  }
}

/**
 * Reads the reason on each connection and again on each `catalog` event for this directory's Location. Only the latest
 * read writes, so a slow answer for an earlier state cannot replace a newer one. A server without the method reports
 * no reason.
 */
export function createKiloCatalog(input: {
  api: OpenCodeClient
  directory: Accessor<string | undefined>
  status: Accessor<string>
  on: (type: typeof catalogEvent, handler: () => void) => () => void
}): Accessor<CatalogFailure | undefined> {
  const rpc = input.api.rpc(KiloGatewayRpc.Definition)
  const [failure, setFailure] = createSignal<CatalogFailure>()
  const state = { read: 0 }
  const refresh = () => {
    const directory = input.directory()
    if (!directory || input.status() !== "connected") return
    const read = ++state.read
    void rpc["catalog.status"]({}, { location: { directory } }).then(
      (result) => read === state.read && setFailure(result.failure ?? undefined),
      () => read === state.read && setFailure(undefined),
    )
  }
  onCleanup(() => {
    state.read++
  })
  createEffect(
    on(
      () => [input.status(), input.directory()] as const,
      ([status, directory]) => status === "connected" && directory && refresh(),
    ),
  )
  onCleanup(input.on(catalogEvent, refresh))
  return failure
}
