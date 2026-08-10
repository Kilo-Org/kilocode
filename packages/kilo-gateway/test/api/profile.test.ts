import { describe, expect, test } from "bun:test"
import { defaultOrganizationId, fetchDefaultModel } from "../../src/api/profile.js"
import type { KilocodeProfile } from "../../src/types.js"

const profile = (input: Partial<KilocodeProfile> = {}): KilocodeProfile => ({
  email: "user@example.com",
  organizations: [{ id: "org_1", name: "Acme", role: "MEMBER" }],
  ...input,
})

describe("defaultOrganizationId", () => {
  test("defaults to the cloud selected organization", () => {
    expect(defaultOrganizationId(profile({ selectedOrganizationId: "org_1" }))).toBe("org_1")
  })

  test("defaults to personal when there is no cloud selection", () => {
    expect(defaultOrganizationId(profile())).toBeUndefined()
  })

  test("ignores a cloud selection that is not one of the user's organizations", () => {
    expect(defaultOrganizationId(profile({ selectedOrganizationId: "missing" }))).toBeUndefined()
  })

  test("falls back to the first organization when there is no personal account", () => {
    expect(
      defaultOrganizationId(
        profile({
          hasPersonalAccount: false,
          organizations: [
            { id: "org_1", name: "Acme", role: "MEMBER" },
            { id: "org_2", name: "Beta", role: "MEMBER" },
          ],
        }),
      ),
    ).toBe("org_1")
  })

  test("prefers a valid cloud selection over the first-organization fallback", () => {
    expect(
      defaultOrganizationId(
        profile({
          selectedOrganizationId: "org_2",
          hasPersonalAccount: false,
          organizations: [
            { id: "org_1", name: "Acme", role: "MEMBER" },
            { id: "org_2", name: "Beta", role: "MEMBER" },
          ],
        }),
      ),
    ).toBe("org_2")
  })
})

describe("fetchDefaultModel", () => {
  test("does not specify Authorization header for /api/defaults without organization id", async () => {
    const original = globalThis.fetch
    const headers: (string | null)[] = []
    const paths: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      paths.push(String(input))
      headers.push(new Headers(init?.headers).get("Authorization"))
      return new Response(JSON.stringify({ defaultModel: "test-model" }), { status: 200 })
    }) as typeof fetch

    try {
      const model = await fetchDefaultModel("secret-token")
      expect(model).toBe("test-model")
      expect(paths[0]).toContain("/api/defaults")
      expect(headers[0]).toBeNull()
    } finally {
      globalThis.fetch = original
    }
  })

  test("specifies Authorization header when organization id is present", async () => {
    const original = globalThis.fetch
    const headers: (string | null)[] = []
    const paths: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      paths.push(String(input))
      headers.push(new Headers(init?.headers).get("Authorization"))
      return new Response(JSON.stringify({ defaultModel: "org-model" }), { status: 200 })
    }) as typeof fetch

    try {
      const model = await fetchDefaultModel("secret-token", "org_123")
      expect(model).toBe("org-model")
      expect(paths[0]).toContain("/api/organizations/org_123/defaults")
      expect(headers[0]).toBe("Bearer secret-token")
    } finally {
      globalThis.fetch = original
    }
  })
})
