import { describe, expect, test } from "bun:test"
import path from "node:path"
import { resolveKiloAiGatewayBase } from "../../src/api/constants"
import { resolveKiloGatewayBaseUrl, resolveKiloGatewayUrl, resolveKiloOpenRouterBaseUrl } from "../../src/api/url"

const src = path.resolve(import.meta.dir, "../../src")

// Gateway URLs are resolved from the environment at module load, so each env
// mode is exercised in a fresh process against the real call sites.
function probe(env: Record<string, string>) {
  const script = `
    const calls = []
    globalThis.fetch = async (input) => {
      calls.push(String(input))
      return Response.json({ data: [], models: [], defaultModel: "" })
    }
    const constants = await import(${JSON.stringify(`${src}/api/constants.ts`)})
    const url = await import(${JSON.stringify(`${src}/api/url.ts`)})
    const models = await import(${JSON.stringify(`${src}/api/models.ts`)})
    const embedding = await import(${JSON.stringify(`${src}/api/embedding-models.ts`)})
    const fim = await import(${JSON.stringify(`${src}/fim.ts`)})
    const edit = await import(${JSON.stringify(`${src}/edit.ts`)})
    await models.fetchKiloModels({})
    await models.fetchKiloModels({ kilocodeOrganizationId: "org-1" })
    await models.fetchKiloTranscriptionModels({})
    await embedding.fetchKiloEmbeddingModelCatalog({ attempts: 1 })
    console.log(JSON.stringify({
      openrouter: constants.KILO_OPENROUTER_BASE,
      gateway: url.resolveKiloGatewayBaseUrl(),
      router: url.resolveKiloOpenRouterBaseUrl(),
      audio: url.resolveKiloGatewayUrl("audio/transcriptions"),
      fim: fim.resolveFimTarget().url,
      edit: edit.resolveEditTarget().url,
      calls,
    }))
  `
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key !== "KILO_API_URL" && key !== "KILO_AI_GATEWAY_URL"),
  )
  const proc = Bun.spawnSync([process.execPath, "-e", script], { env: { ...base, ...env }, cwd: src })
  expect(proc.stderr.toString()).toBe("")
  return JSON.parse(proc.stdout.toString())
}

describe("resolveKiloAiGatewayBase", () => {
  test("defaults to the AI gateway when no override is set", () => {
    expect(resolveKiloAiGatewayBase({})).toBe("https://ai-gateway.kilo.ai/api/v1")
  })

  test("uses the API app's gateway rewrite when only KILO_API_URL is set", () => {
    expect(resolveKiloAiGatewayBase({ KILO_API_URL: "http://localhost:3000/" })).toBe(
      "http://localhost:3000/api/gateway/v1",
    )
  })

  test("prefers KILO_AI_GATEWAY_URL over KILO_API_URL", () => {
    expect(
      resolveKiloAiGatewayBase({
        KILO_API_URL: "http://localhost:3000",
        KILO_AI_GATEWAY_URL: "http://localhost:3001/api/v1/",
      }),
    ).toBe("http://localhost:3001/api/v1")
  })

  test("ignores blank KILO_AI_GATEWAY_URL", () => {
    expect(resolveKiloAiGatewayBase({ KILO_AI_GATEWAY_URL: "  " })).toBe("https://ai-gateway.kilo.ai/api/v1")
  })
})

describe("gateway traffic by environment", () => {
  test("routes to the AI gateway by default", () => {
    expect(probe({})).toEqual({
      openrouter: "https://ai-gateway.kilo.ai/api/v1",
      gateway: "https://ai-gateway.kilo.ai/api/v1/",
      router: "https://ai-gateway.kilo.ai/api/v1/",
      audio: "https://ai-gateway.kilo.ai/api/v1/audio/transcriptions",
      fim: "https://ai-gateway.kilo.ai/api/v1/fim/completions",
      edit: "https://ai-gateway.kilo.ai/api/v1/edit/completions",
      calls: [
        "https://ai-gateway.kilo.ai/api/v1/models",
        "https://ai-gateway.kilo.ai/api/v1/organizations/org-1/models",
        "https://ai-gateway.kilo.ai/api/v1/transcription-models",
        "https://ai-gateway.kilo.ai/api/v1/embedding-models",
      ],
    })
  })

  test("routes through KILO_API_URL/api/gateway/v1 when only KILO_API_URL is set", () => {
    expect(probe({ KILO_API_URL: "http://localhost:3000" })).toEqual({
      openrouter: "http://localhost:3000/api/gateway/v1",
      gateway: "http://localhost:3000/api/gateway/v1/",
      router: "http://localhost:3000/api/gateway/v1/",
      audio: "http://localhost:3000/api/gateway/v1/audio/transcriptions",
      fim: "http://localhost:3000/api/gateway/v1/fim/completions",
      edit: "http://localhost:3000/api/gateway/v1/edit/completions",
      calls: [
        "http://localhost:3000/api/gateway/v1/models",
        "http://localhost:3000/api/gateway/v1/organizations/org-1/models",
        "http://localhost:3000/api/gateway/v1/transcription-models",
        "http://localhost:3000/api/gateway/v1/embedding-models",
      ],
    })
  })

  test("routes gateway traffic to KILO_AI_GATEWAY_URL when both are set", () => {
    expect(probe({ KILO_API_URL: "http://localhost:3000", KILO_AI_GATEWAY_URL: "http://localhost:3001/gw/" })).toEqual({
      openrouter: "http://localhost:3001/gw",
      gateway: "http://localhost:3001/gw/",
      router: "http://localhost:3001/gw/",
      audio: "http://localhost:3001/gw/audio/transcriptions",
      fim: "http://localhost:3001/gw/fim/completions",
      edit: "http://localhost:3001/gw/edit/completions",
      calls: [
        "http://localhost:3001/gw/models",
        "http://localhost:3001/gw/organizations/org-1/models",
        "http://localhost:3001/gw/transcription-models",
        "http://localhost:3001/gw/embedding-models",
      ],
    })
  })
})

describe("Kilo API URL resolvers", () => {
  test("resolves the AI gateway root by default", () => {
    expect(resolveKiloGatewayBaseUrl()).toBe("https://ai-gateway.kilo.ai/api/v1/")
    expect(resolveKiloOpenRouterBaseUrl()).toBe("https://ai-gateway.kilo.ai/api/v1/")
    expect(resolveKiloGatewayUrl("fim/completions")).toBe("https://ai-gateway.kilo.ai/api/v1/fim/completions")
  })

  test("keeps the configured AI gateway base on the gateway root", () => {
    expect(resolveKiloOpenRouterBaseUrl({ baseURL: "https://ai-gateway.kilo.ai/api/v1/" })).toBe(
      "https://ai-gateway.kilo.ai/api/v1/",
    )
    expect(resolveKiloGatewayBaseUrl({ baseURL: "https://ai-gateway.kilo.ai/api/v1?x=1" })).toBe(
      "https://ai-gateway.kilo.ai/api/v1/",
    )
  })

  test("keeps legacy routing for custom base URLs that contain /api/v1", () => {
    expect(resolveKiloOpenRouterBaseUrl({ baseURL: "https://proxy.test/api/v1/custom" })).toBe(
      "https://proxy.test/api/openrouter/",
    )
    expect(resolveKiloGatewayBaseUrl({ baseURL: "https://proxy.test/dev/api/v1" })).toBe(
      "https://proxy.test/dev/api/gateway/",
    )
  })

  test("normalizes root API base overrides", () => {
    expect(resolveKiloGatewayBaseUrl({ baseURL: "https://example.test" })).toBe("https://example.test/api/gateway/")
    expect(resolveKiloOpenRouterBaseUrl({ baseURL: "https://example.test/" })).toBe(
      "https://example.test/api/openrouter/",
    )
  })

  test("replaces existing Kilo API route paths", () => {
    expect(resolveKiloGatewayBaseUrl({ baseURL: "https://example.test/api/openrouter/" })).toBe(
      "https://example.test/api/gateway/",
    )
    expect(resolveKiloOpenRouterBaseUrl({ baseURL: "https://example.test/api/gateway/" })).toBe(
      "https://example.test/api/openrouter/",
    )
  })

  test("preserves path prefixes before api", () => {
    expect(resolveKiloGatewayBaseUrl({ baseURL: "https://example.test/dev/api/openrouter/" })).toBe(
      "https://example.test/dev/api/gateway/",
    )
    expect(resolveKiloOpenRouterBaseUrl({ baseURL: "https://example.test/dev" })).toBe(
      "https://example.test/dev/api/openrouter/",
    )
  })

  test("strips search and hash components", () => {
    expect(resolveKiloGatewayBaseUrl({ baseURL: "https://example.test/api/openrouter/?x=1#frag" })).toBe(
      "https://example.test/api/gateway/",
    )
  })

  test("prefers token-derived URL when token contains one", () => {
    expect(resolveKiloGatewayBaseUrl({ baseURL: "https://fallback.test", token: "https://token.test:opaque" })).toBe(
      "https://token.test/api/gateway/",
    )
    expect(resolveKiloOpenRouterBaseUrl({ token: "https://token.test:opaque" })).toBe(
      "https://token.test/api/openrouter/",
    )
  })

  test("resolves child endpoint URLs", () => {
    expect(new URL("embedding-models", resolveKiloGatewayBaseUrl({ baseURL: "https://example.test" })).toString()).toBe(
      "https://example.test/api/gateway/embedding-models",
    )
  })
})
