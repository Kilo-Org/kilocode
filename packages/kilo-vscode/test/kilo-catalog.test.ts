// The Kilo catalog failure reasons: their message keys and the sign-in action, as v1 `provider-failure.test.ts`.
import { describe, expect, test } from "bun:test"
import { dict } from "../webview-ui/src/i18n/en"
import { failureMessage, failureNeedsSignIn } from "../webview-ui/src/v2/kilo-catalog"

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
