// The Kilo catalog failure reasons: their message keys and the sign-in action, as v1 `provider-failure.test.ts`.
import { describe, expect, mock, test } from "bun:test"
import type * as Solid from "solid-js"
import { dict } from "../webview-ui/src/i18n/en"

// A bun test resolves `solid-js` to its server build, where effects never run. The webview bundles the client
// build, so the reactive tests load it here before the module under test.
// @ts-expect-error the client build ships no declaration file
mock.module("solid-js", () => import("solid-js/dist/solid.js"))
const { createKiloCatalog, failureMessage, failureNeedsSignIn } = await import("../webview-ui/src/v2/kilo-catalog")
// @ts-expect-error the client build ships no declaration file
const { createRoot, createSignal } = (await import("solid-js/dist/solid.js")) as typeof Solid
type Failure = Parameters<typeof failureNeedsSignIn>[0]

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

type CatalogResult = { failure?: Failure }

const flush = async () => {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const setup = (initial: string) => {
  const [status, setStatus] = createSignal(initial)
  const handlers = new Set<() => void>()
  const pending: Array<{ directory: string; resolve: (value: CatalogResult) => void; reject: (error: unknown) => void }> = []
  const api = {
    rpc: () => ({
      "catalog.status": (_input: unknown, options: { location: { directory: string } }) =>
        new Promise<CatalogResult>((resolve, reject) => pending.push({ directory: options.location.directory, resolve, reject })),
    }),
  }
  let failure: () => Failure | undefined = () => undefined
  let dispose = () => {}
  createRoot((root) => {
    dispose = root
    failure = createKiloCatalog({
      api: api as never,
      directory: "/repo",
      status,
      on: (_type, handler) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
    })
  })
  return { setStatus, pending, handlers, failure: () => failure(), dispose }
}

describe("createKiloCatalog", () => {
  test("reads the reason only while the connection is up", async () => {
    const test = setup("disconnected")
    await flush()
    expect(test.pending).toHaveLength(0)

    test.setStatus("connecting")
    await flush()
    expect(test.pending).toHaveLength(0)

    test.setStatus("connected")
    await flush()
    expect(test.pending).toHaveLength(1)
    expect(test.pending[0].directory).toBe("/repo")

    test.setStatus("disconnected")
    test.setStatus("connected")
    await flush()
    expect(test.pending).toHaveLength(2)
    test.dispose()
  })

  test("refresh follows the catalog event and stops on cleanup", async () => {
    const test = setup("disconnected")
    await flush()
    expect(test.handlers.size).toBe(1)

    for (const handler of test.handlers) handler()
    await flush()
    expect(test.pending).toHaveLength(1)

    test.dispose()
    expect(test.handlers.size).toBe(0)
  })

  test("keeps the latest read when an earlier answer arrives later", async () => {
    const test = setup("disconnected")
    await flush()
    test.setStatus("connected")
    await flush()
    for (const handler of test.handlers) handler()
    await flush()
    expect(test.pending).toHaveLength(2)

    test.pending[1].resolve({ failure: { kind: "network" } })
    await flush()
    expect(test.failure()).toEqual({ kind: "network" })

    test.pending[0].resolve({ failure: { kind: "schema" } })
    await flush()
    expect(test.failure()).toEqual({ kind: "network" })
    test.dispose()
  })

  test("clears the reason when the read fails", async () => {
    const test = setup("disconnected")
    await flush()
    test.setStatus("connected")
    await flush()
    test.pending[0].resolve({ failure: { kind: "http", status: 503 } })
    await flush()
    expect(test.failure()).toEqual({ kind: "http", status: 503 })

    for (const handler of test.handlers) handler()
    await flush()
    test.pending[1].reject(new Error("offline"))
    await flush()
    expect(test.failure()).toBeUndefined()
    test.dispose()
  })
})
