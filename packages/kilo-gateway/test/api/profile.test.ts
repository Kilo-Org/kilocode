import { describe, expect, test } from "bun:test"
import { defaultOrganizationId, fetchDefaultModel } from "../../src/api/profile.js"
import { DEFAULT_FREE_MODEL, DEFAULT_MODEL } from "../../src/api/constants.js"
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
  function stub(fn: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
    const orig = globalThis.fetch
    globalThis.fetch = fn as typeof fetch
    return () => {
      globalThis.fetch = orig
    }
  }

  test("omits Authorization on /api/defaults even when a token is present", async () => {
    let path = ""
    let auth: string | null = null
    const restore = stub(async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init)
      path = new URL(req.url).pathname
      auth = req.headers.get("authorization")
      return Response.json({ defaultModel: "kilo/paid", defaultFreeModel: "kilo/free" })
    })

    try {
      const model = await fetchDefaultModel("stored-token")
      expect(path).toBe("/api/defaults")
      expect(auth).toBeNull()
      expect(model).toBe("kilo/paid")
    } finally {
      restore()
    }
  })

  test("sends Authorization only for organization defaults", async () => {
    let path = ""
    let auth: string | null = null
    const restore = stub(async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init)
      path = new URL(req.url).pathname
      auth = req.headers.get("authorization")
      return Response.json({ defaultModel: "kilo/org" })
    })

    try {
      const model = await fetchDefaultModel("stored-token", "org_1")
      expect(path).toBe("/api/organizations/org_1/defaults")
      expect(auth).toBe("Bearer stored-token")
      expect(model).toBe("kilo/org")
    } finally {
      restore()
    }
  })

  test("uses the public free model when no token is provided", async () => {
    const restore = stub(async () => Response.json({ defaultModel: "kilo/paid", defaultFreeModel: "kilo/free" }))
    try {
      expect(await fetchDefaultModel()).toBe("kilo/free")
    } finally {
      restore()
    }
  })

  test("falls back to bundled defaults when the request fails", async () => {
    const restore = stub(async () => new Response(null, { status: 500 }))
    try {
      expect(await fetchDefaultModel("stored-token")).toBe(DEFAULT_MODEL)
      expect(await fetchDefaultModel()).toBe(DEFAULT_FREE_MODEL)
    } finally {
      restore()
    }
  })
})
