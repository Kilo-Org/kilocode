// The Kilo catalog failure reasons: their message keys and the sign-in action, as v1 `provider-failure.test.ts`.
import { describe, expect, mock, test } from "bun:test"
import type { OpenCodeClient } from "@opencode/client"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import type { Accessor, Setter } from "solid-js"
import { dict } from "../webview-ui/src/i18n/en"

// The package resolves the server build of Solid outside a renderer, where effects never run.
const CLIENT_SOLID = "solid-js/dist/solid.js"
mock.module("solid-js", () => import(CLIENT_SOLID))

const { createRoot, createSignal } = (await import(CLIENT_SOLID)) as {
  createRoot: <T>(fn: (dispose: () => void) => T) => T
  createSignal: <T>(value: T) => [Accessor<T>, Setter<T>]
}
const { createKiloCatalog, failureMessage, failureNeedsSignIn } = await import("../webview-ui/src/v2/kilo-catalog")

const t = (key: string, vars?: { status: number }) => (vars ? `${key}:${vars.status}` : key)

describe("failureMessage", () => {
  test("selects the status-bearing keys when a status is present", () => {
    expect(failureMessage(t, { kind: "unauthorized", status: 401 })).toBe("provider.failure.unauthorized:401")
    expect(failureMessage(t, { kind: "http", status: 503 })).toBe("provider.failure.http:503")
  })

  test("falls back to the status-free keys without a status", () => {
    expect(failureMessage(t, { kind: "unauthorized" })).toBe("provider.failure.unauthorizedNoStatus")
    expect(failureMessage(t, { kind: "http" })).toBe("provider.failure.httpNoStatus")
  })

  test("maps each remaining kind to its key", () => {
    expect(failureMessage(t, { kind: "unauthenticated" })).toBe("provider.failure.unauthenticated")
    expect(failureMessage(t, { kind: "network" })).toBe("provider.failure.network")
    expect(failureMessage(t, { kind: "schema" })).toBe("provider.failure.schema")
    expect(failureMessage(t, { kind: "organization_missing" })).toBe("provider.failure.organizationMissing")
    expect(failureMessage(t, { kind: "scope_conflict" })).toBe("provider.failure.scopeConflict")
    expect(failureMessage(t, { kind: "personal_unavailable" })).toBe("provider.failure.personalUnavailable")
  })

  test("reports no message without a failure", () => {
    expect(failureMessage(t, undefined)).toBeUndefined()
  })

  test("every key has English copy", () => {
    const kinds = [
      { kind: "unauthorized", status: 401 },
      { kind: "unauthorized" },
      { kind: "unauthenticated" },
      { kind: "network" },
      { kind: "http", status: 500 },
      { kind: "http" },
      { kind: "schema" },
      { kind: "organization_missing" },
      { kind: "scope_conflict" },
      { kind: "personal_unavailable" },
    ] as const
    for (const failure of kinds) expect(dict).toHaveProperty([failureMessage((key) => key, failure) ?? ""])
  })
})

describe("failureNeedsSignIn", () => {
  test("offers sign-in only for missing or rejected credentials", () => {
    expect(failureNeedsSignIn({ kind: "unauthorized" })).toBe(true)
    expect(failureNeedsSignIn({ kind: "unauthorized", status: 403 })).toBe(true)
    expect(failureNeedsSignIn({ kind: "unauthenticated" })).toBe(true)
    expect(failureNeedsSignIn({ kind: "network" })).toBe(false)
    expect(failureNeedsSignIn({ kind: "http", status: 503 })).toBe(false)
    expect(failureNeedsSignIn({ kind: "schema" })).toBe(false)
    expect(failureNeedsSignIn({ kind: "organization_missing" })).toBe(false)
    expect(failureNeedsSignIn({ kind: "scope_conflict" })).toBe(false)
    expect(failureNeedsSignIn({ kind: "personal_unavailable" })).toBe(false)
  })
})

describe("createKiloCatalog", () => {
  test("refreshes on each connected transition and on each catalog event", async () => {
    const catalog = makeCatalog()
    try {
      catalog.setStatus("connected")
      await tick()
      expect(catalog.calls).toHaveLength(1)

      catalog.calls[0].resolve({ failure: { kind: "network" } })
      await tick()
      expect(catalog.failure()).toEqual({ kind: "network" })

      catalog.setStatus("disconnected")
      catalog.setStatus("connected")
      await tick()
      expect(catalog.calls).toHaveLength(2)

      catalog.calls[1].resolve({ failure: { kind: "http", status: 503 } })
      await tick()
      expect(catalog.failure()).toEqual({ kind: "http", status: 503 })

      catalog.emit()
      catalog.emit()
      expect(catalog.calls).toHaveLength(4)
    } finally {
      catalog.dispose()
    }
  })

  test("only the latest read writes when an earlier answer arrives late", async () => {
    const catalog = makeCatalog()
    try {
      catalog.setStatus("connected")
      await tick()
      catalog.emit()
      expect(catalog.calls).toHaveLength(2)

      catalog.calls[1].resolve({ failure: { kind: "http", status: 503 } })
      await tick()
      expect(catalog.failure()).toEqual({ kind: "http", status: 503 })

      catalog.calls[0].resolve({ failure: { kind: "network" } })
      await tick()
      expect(catalog.failure()).toEqual({ kind: "http", status: 503 })
    } finally {
      catalog.dispose()
    }
  })

  test("a failed read clears the reason only when it is the latest", async () => {
    const catalog = makeCatalog()
    try {
      catalog.setStatus("connected")
      await tick()
      catalog.emit()
      expect(catalog.calls).toHaveLength(2)

      catalog.calls[1].resolve({ failure: { kind: "network" } })
      await tick()
      expect(catalog.failure()).toEqual({ kind: "network" })

      catalog.calls[0].reject(new Error("stale"))
      await tick()
      expect(catalog.failure()).toEqual({ kind: "network" })

      catalog.emit()
      expect(catalog.calls).toHaveLength(3)
      catalog.calls[2].reject(new Error("latest"))
      await tick()
      expect(catalog.failure()).toBeUndefined()
    } finally {
      catalog.dispose()
    }
  })
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function makeCatalog() {
  const [status, setStatus] = createSignal("disconnected")
  const listeners = new Set<() => void>()
  const calls: Array<{
    resolve: (value: { failure?: KiloGatewayRpc.CatalogFailure }) => void
    reject: (error: unknown) => void
  }> = []
  const api = {
    rpc: () => ({
      "catalog.status": () =>
        new Promise<{ failure?: KiloGatewayRpc.CatalogFailure }>((resolve, reject) => calls.push({ resolve, reject })),
    }),
  } as unknown as OpenCodeClient

  const setup = createRoot((dispose) => ({
    failure: createKiloCatalog({
      api,
      directory: "/project",
      status,
      on: (_type, handler) => {
        listeners.add(handler)
        return () => listeners.delete(handler)
      },
    }),
    dispose,
  }))

  return {
    ...setup,
    calls,
    setStatus,
    emit: () => {
      for (const listener of listeners) listener()
    },
  }
}
