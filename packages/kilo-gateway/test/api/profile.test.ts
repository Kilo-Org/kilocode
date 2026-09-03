import { describe, expect, spyOn, test } from "bun:test"
import { defaultOrganizationId, fetchDefaultModel } from "../../src/api/profile.js"
import { DEFAULT_FREE_MODEL, DEFAULT_MODEL, KILO_API_BASE } from "../../src/api/constants.js"
import type { KilocodeProfile } from "../../src/types.js"

describe("fetchDefaultModel", () => {
  const failures: [string, () => Promise<Response>][] = [
    ["missing", async () => Response.json({})],
    ["empty", async () => Response.json({ defaultModel: "", defaultFreeModel: "" })],
    ["unauthorized", async () => new Response(null, { status: 401 })],
    ["server error", async () => new Response(null, { status: 500 })],
    ["invalid JSON", async () => new Response("invalid")],
    ["network error", async () => Promise.reject(new Error("offline"))],
  ]

  test.each(failures)("preserves old defaults and accepts an Org fallback: %s", async (_, response) => {
    const fetch = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(response, { preconnect: globalThis.fetch.preconnect }),
    )
    try {
      expect(await fetchDefaultModel()).toBe(DEFAULT_FREE_MODEL)
      expect(await fetchDefaultModel("token")).toBe(DEFAULT_MODEL)
      expect(await fetchDefaultModel("token", "org")).toBe(DEFAULT_MODEL)
      expect(await fetchDefaultModel("token", "org", "allowed/first")).toBe("allowed/first")
      expect(await fetchDefaultModel("token", "org", "")).toBe("")
    } finally {
      fetch.mockRestore()
    }
  })

  test("uses the API default ahead of the supplied fallback", async () => {
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ defaultModel: "allowed/default", defaultFreeModel: "public/free" }),
    )
    try {
      expect(await fetchDefaultModel("token", "org", "allowed/first")).toBe("allowed/default")
      expect(fetch.mock.calls.at(0)?.at(0)).toBe(`${KILO_API_BASE}/api/organizations/org/defaults`)
    } finally {
      fetch.mockRestore()
    }
  })

  test("keeps anonymous API defaults", async () => {
    const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ defaultModel: "paid", defaultFreeModel: "public/free" }),
    )
    try {
      expect(await fetchDefaultModel()).toBe("public/free")
    } finally {
      fetch.mockRestore()
    }
  })
})

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
