import { describe, expect, test } from "bun:test"
import {
  resolveKiloAiGatewayRoot,
  resolveKiloAiGatewayUrl,
  resolveKiloGatewayBaseUrl,
  resolveKiloOpenRouterBaseUrl,
} from "../../src/api/url"

describe("Kilo API URL resolvers", () => {
  test("resolves legacy route bases when KILO_API_URL is set", () => {
    expect(resolveKiloGatewayBaseUrl({ api: "https://api.kilo.ai" })).toBe("https://api.kilo.ai/api/gateway/")
    expect(resolveKiloOpenRouterBaseUrl({ api: "https://api.example.test" })).toBe(
      "https://api.example.test/api/openrouter/",
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
  })

  test("resolves child endpoint URLs", () => {
    expect(new URL("embedding-models", resolveKiloGatewayBaseUrl({ baseURL: "https://example.test" })).toString()).toBe(
      "https://example.test/api/gateway/embedding-models",
    )
  })
})

describe("Kilo AI Gateway resolvers", () => {
  test("use the production gateway when neither KILO_API_URL nor KILO_AI_GATEWAY_URL is set", () => {
    expect(resolveKiloAiGatewayRoot()).toBe("https://ai-gateway.kilo.ai/api/v1/")
    expect(resolveKiloGatewayBaseUrl()).toBe("https://ai-gateway.kilo.ai/api/v1/")
    expect(resolveKiloOpenRouterBaseUrl()).toBe("https://ai-gateway.kilo.ai/api/v1/")
    expect(resolveKiloAiGatewayUrl("fim/completions", "/api/fim/completions")).toBe(
      "https://ai-gateway.kilo.ai/api/v1/fim/completions",
    )
  })

  test("keep the legacy routes on KILO_API_URL when only that is set", () => {
    const api = "http://localhost:3000"
    expect(resolveKiloAiGatewayRoot({ api })).toBeUndefined()
    expect(resolveKiloAiGatewayUrl("fim/completions", "/api/fim/completions", { api })).toBe(
      "http://localhost:3000/api/fim/completions",
    )
  })

  test("keep the legacy routes on a URL embedded in the token", () => {
    expect(resolveKiloAiGatewayRoot({ token: "https://token.test:opaque" })).toBeUndefined()
    expect(resolveKiloOpenRouterBaseUrl({ token: "https://token.test:opaque" })).toBe(
      "https://token.test/api/openrouter/",
    )
  })

  test("treat a malformed KILO_AI_GATEWAY_URL as unset", () => {
    expect(resolveKiloAiGatewayRoot({ gateway: "not a url" })).toBe("https://ai-gateway.kilo.ai/api/v1/")
    expect(resolveKiloAiGatewayRoot({ gateway: "not a url", api: "https://api.example.test" })).toBeUndefined()
  })

  test("prefer KILO_AI_GATEWAY_URL over KILO_API_URL", () => {
    expect(resolveKiloAiGatewayRoot({ gateway: "http://localhost:3010/api/v1", api: "http://localhost:3000" })).toBe(
      "http://localhost:3010/api/v1/",
    )
  })

  test("serve every AI route from the gateway URL as given", () => {
    const gateway = "https://gateway.test/v1?x=1"
    expect(resolveKiloAiGatewayRoot({ gateway })).toBe("https://gateway.test/v1/")
    expect(resolveKiloGatewayBaseUrl({ gateway })).toBe("https://gateway.test/v1/")
    expect(resolveKiloOpenRouterBaseUrl({ gateway })).toBe("https://gateway.test/v1/")
    expect(resolveKiloAiGatewayUrl("fim/completions", "/api/fim/completions", { gateway })).toBe(
      "https://gateway.test/v1/fim/completions",
    )
  })

  test("prefer the gateway over a token-derived URL", () => {
    const gateway = "https://gateway.test/api/v1"
    expect(resolveKiloOpenRouterBaseUrl({ gateway, token: "https://token.test:opaque" })).toBe(
      "https://gateway.test/api/v1/",
    )
  })

  test("keep a baseURL under the gateway on the gateway", () => {
    const gateway = "https://gateway.test/api/v1"
    expect(resolveKiloOpenRouterBaseUrl({ gateway, baseURL: "https://gateway.test/api/v1/" })).toBe(
      "https://gateway.test/api/v1/",
    )
    expect(resolveKiloOpenRouterBaseUrl({ baseURL: "https://ai-gateway.kilo.ai/api/v1/" })).toBe(
      "https://ai-gateway.kilo.ai/api/v1/",
    )
  })

  test("keep a baseURL elsewhere on its Kilo API routes", () => {
    const options = { gateway: "https://gateway.test/api/v1", baseURL: "https://example.test" }
    expect(resolveKiloAiGatewayRoot(options)).toBeUndefined()
    expect(resolveKiloGatewayBaseUrl(options)).toBe("https://example.test/api/gateway/")
    expect(resolveKiloOpenRouterBaseUrl(options)).toBe("https://example.test/api/openrouter/")
    expect(resolveKiloOpenRouterBaseUrl({ baseURL: "https://api.kilo.ai/api/organizations/org" })).toBe(
      "https://api.kilo.ai/api/openrouter/",
    )
  })
})

describe("environment", () => {
  test.each([
    {
      mode: "only KILO_API_URL",
      seen: [
        "api /api/openrouter/models",
        "api /api/organizations/org/models",
        "api /api/gateway/transcription-models",
        "api /api/gateway/embedding-models",
        "api /api/defaults",
        "api /api/openrouter/chat/completions",
      ],
      urls: {
        openrouter: "<api>/api/openrouter",
        fim: "<api>/api/fim/completions",
        edit: "<api>/api/edit/completions",
        transcriptions: "<api>/api/gateway/v1/audio/transcriptions",
      },
    },
    {
      mode: "both",
      seen: [
        "gateway /api/v1/models",
        "gateway /api/v1/organizations/org/models",
        "gateway /api/v1/transcription-models",
        "gateway /api/v1/embedding-models",
        "api /api/defaults",
        "gateway /api/v1/chat/completions",
      ],
      urls: {
        openrouter: "<gateway>/api/v1",
        fim: "<gateway>/api/v1/fim/completions",
        edit: "<gateway>/api/v1/edit/completions",
        transcriptions: "<gateway>/api/v1/audio/transcriptions",
      },
    },
  ])("routes Kilo requests with $mode set", async (input) => {
    const script = `
      const seen = []
      const serve = (name) => Bun.serve({
        port: 0,
        fetch(req) {
          seen.push(name + " " + new URL(req.url).pathname)
          return Response.json({ data: [], defaultModel: "test/model" })
        },
      })
      const api = serve("api")
      const gateway = serve("gateway")
      process.env.KILO_API_URL = "http://localhost:" + api.port
      if (${JSON.stringify(input.mode)} === "both") process.env.KILO_AI_GATEWAY_URL = "http://localhost:" + gateway.port + "/api/v1"
      else delete process.env.KILO_AI_GATEWAY_URL
      const kilo = await import(${JSON.stringify(Bun.resolveSync("../../src/index.ts", import.meta.dir))})
      const fim = await import(${JSON.stringify(Bun.resolveSync("../../src/fim.ts", import.meta.dir))})
      const edit = await import(${JSON.stringify(Bun.resolveSync("../../src/edit.ts", import.meta.dir))})
      const strip = (url) =>
        url.replace("http://localhost:" + gateway.port, "<gateway>").replace("http://localhost:" + api.port, "<api>")
      await kilo.fetchKiloModels({ kilocodeToken: "token" })
      await kilo.fetchKiloModels({ kilocodeToken: "token", kilocodeOrganizationId: "org" })
      await kilo.fetchKiloTranscriptionModels({ kilocodeToken: "token" })
      await kilo.fetchKiloEmbeddingModelCatalog({ token: "token" })
      await kilo.fetchDefaultModel("token")
      // The CLI hands the provider's api URL (KILO_OPENROUTER_BASE) to createKilo as baseURL.
      const prompt = [{ role: "user", content: [{ type: "text", text: "hi" }] }]
      await kilo.createKilo({ baseURL: kilo.KILO_OPENROUTER_BASE + "/", kilocodeToken: "token" })
        .openaiCompatible("test/model")
        .doGenerate({ prompt })
        .catch(() => undefined)
      console.log(JSON.stringify({
        seen,
        urls: {
          openrouter: strip(kilo.KILO_OPENROUTER_BASE),
          fim: strip(fim.resolveFimTarget().url),
          edit: strip(edit.resolveEditTarget().url),
          transcriptions: strip(kilo.resolveKiloAiGatewayUrl("audio/transcriptions", "/api/gateway/v1/audio/transcriptions")),
        },
      }))
      api.stop(true)
      gateway.stop(true)
    `
    const proc = Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    expect(err).toBe("")
    expect(code).toBe(0)
    expect(JSON.parse(out.trim().split("\n").at(-1) ?? "")).toEqual({ seen: input.seen, urls: input.urls })
  })
})
