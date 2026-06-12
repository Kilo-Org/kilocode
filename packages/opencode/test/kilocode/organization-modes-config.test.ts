import { afterEach, describe, expect, test } from "bun:test"
import { clearModesCache } from "@kilocode/kilo-gateway"
import { KilocodeConfig } from "../../src/kilocode/config/config"

const original = globalThis.fetch

function mode(slug: string, defaultModel?: string) {
  return {
    id: slug,
    organization_id: "org",
    name: slug,
    slug,
    created_by: "user",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    config: {
      roleDefinition: `${slug} role`,
      groups: ["read"],
      ...(defaultModel ? { defaultModel } : {}),
    },
  }
}

function stub(modes: ReturnType<typeof mode>[]) {
  globalThis.fetch = Object.assign(
    async () =>
      new Response(JSON.stringify({ modes }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    { preconnect: original.preconnect },
  )
}

function auth(accountId?: string) {
  return accountId ? { kilo: { type: "oauth", access: "token", accountId } } : {}
}

afterEach(() => {
  globalThis.fetch = original
  clearModesCache()
})

describe("organization mode config loading", () => {
  test("injects alias defaults onto canonical native agents without rewriting the legacy row", async () => {
    stub([mode("architect", "openai/gpt-4o:thinking")])

    const result = await KilocodeConfig.loadOrganizationModes(auth("org-a"))

    expect(result.agents.architect.prompt).toBe("architect role")
    expect(result.agents.architect.options?.orgDefaultModel).toBeUndefined()
    expect(result.agents.plan.options?.orgDefaultModel).toBe("openai/gpt-4o:thinking")
  })

  test("replaces org fallback layers and omits them for personal auth", async () => {
    stub([mode("code", "kilo-auto/balanced")])
    const orgA = await KilocodeConfig.loadOrganizationModes(auth("org-a"))
    expect(orgA.agents.code.options?.orgDefaultModel).toBe("kilo-auto/balanced")

    clearModesCache()
    stub([mode("code", "openai/gpt-4o:free")])
    const orgB = await KilocodeConfig.loadOrganizationModes(auth("org-b"))
    expect(orgB.agents.code.options?.orgDefaultModel).toBe("openai/gpt-4o:free")

    const personal = await KilocodeConfig.loadOrganizationModes(auth())
    expect(personal.agents).toEqual({})
  })
})
