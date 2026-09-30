import { describe, expect, test } from "bun:test"
import {
  resolveKiloAiGatewayRoot,
  resolveKiloAiGatewayUrl,
  resolveKiloGatewayBaseUrl,
  resolveKiloOpenRouterBaseUrl,
} from "../../src/api/url"

describe("Kilo API URL resolvers", () => {
  test("resolves production route bases", () => {
    expect(resolveKiloGatewayBaseUrl()).toBe("https://api.kilo.ai/api/gateway/")
    expect(resolveKiloOpenRouterBaseUrl()).toBe("https://api.kilo.ai/api/openrouter/")
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

describe("Dedicated Kilo AI Gateway URL resolvers", () => {
  test("has no dedicated gateway by default", () => {
    expect(resolveKiloAiGatewayRoot()).toBeUndefined()
    expect(resolveKiloAiGatewayUrl("fim/completions", "/api/fim/completions")).toBe(
      "https://api.kilo.ai/api/fim/completions",
    )
  })

  test("serves every AI route from the gateway's /api/v1", () => {
    const gateway = "https://gateway.test"
    expect(resolveKiloAiGatewayRoot({ gateway })).toBe("https://gateway.test/api/v1/")
    expect(resolveKiloGatewayBaseUrl({ gateway })).toBe("https://gateway.test/api/v1/")
    expect(resolveKiloOpenRouterBaseUrl({ gateway })).toBe("https://gateway.test/api/v1/")
    expect(resolveKiloAiGatewayUrl("fim/completions", "/api/fim/completions", { gateway })).toBe(
      "https://gateway.test/api/v1/fim/completions",
    )
  })

  test("normalizes gateway URLs that already include an api path", () => {
    expect(resolveKiloAiGatewayRoot({ gateway: "https://gateway.test/api/v1" })).toBe("https://gateway.test/api/v1/")
    expect(resolveKiloAiGatewayRoot({ gateway: "https://gateway.test/dev/api/" })).toBe(
      "https://gateway.test/dev/api/v1/",
    )
    expect(resolveKiloAiGatewayRoot({ gateway: "http://localhost:3010/?x=1" })).toBe("http://localhost:3010/api/v1/")
  })

  test("prefers the dedicated gateway over a token-derived URL", () => {
    expect(resolveKiloOpenRouterBaseUrl({ gateway: "https://gateway.test", token: "https://token.test:opaque" })).toBe(
      "https://gateway.test/api/v1/",
    )
  })

  test("keeps an explicit baseURL on another origin on the Kilo API routes", () => {
    const options = { gateway: "https://gateway.test", baseURL: "https://example.test" }
    expect(resolveKiloAiGatewayRoot(options)).toBeUndefined()
    expect(resolveKiloGatewayBaseUrl(options)).toBe("https://example.test/api/gateway/")
    expect(resolveKiloOpenRouterBaseUrl(options)).toBe("https://example.test/api/openrouter/")
  })

  test("keeps a baseURL on the gateway's origin on the gateway", () => {
    const options = {
      gateway: "https://gateway.test",
      baseURL: "https://gateway.test/api/v1",
      token: "https://token.test:x",
    }
    expect(resolveKiloGatewayBaseUrl(options)).toBe("https://gateway.test/api/v1/")
    expect(resolveKiloOpenRouterBaseUrl(options)).toBe("https://gateway.test/api/v1/")
  })
})

describe("KILO_AI_GATEWAY_URL", () => {
  test("routes AI endpoints to the gateway and other cloud endpoints to KILO_API_URL", async () => {
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
      process.env.KILO_API_URL = api.url.origin
      process.env.KILO_AI_GATEWAY_URL = gateway.url.origin
      const kilo = await import(${JSON.stringify(Bun.resolveSync("../../src/index.ts", import.meta.dir))})
      const fim = await import(${JSON.stringify(Bun.resolveSync("../../src/fim.ts", import.meta.dir))})
      const edit = await import(${JSON.stringify(Bun.resolveSync("../../src/edit.ts", import.meta.dir))})
      const strip = (url) => url.replace(gateway.url.origin, "<gateway>").replace(api.url.origin, "<api>")
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
        openrouter: strip(kilo.KILO_OPENROUTER_BASE),
        fim: strip(fim.resolveFimTarget().url),
        edit: strip(edit.resolveEditTarget().url),
        transcriptions: strip(kilo.resolveKiloAiGatewayUrl("audio/transcriptions", "/api/gateway/v1/audio/transcriptions")),
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
    expect(JSON.parse(out.trim().split("\n").at(-1) ?? "")).toEqual({
      seen: [
        "gateway /api/v1/models",
        "gateway /api/v1/organizations/org/models",
        "gateway /api/v1/transcription-models",
        "gateway /api/v1/embedding-models",
        "api /api/defaults",
        "gateway /api/v1/chat/completions",
      ],
      openrouter: "<gateway>/api/v1",
      fim: "<gateway>/api/v1/fim/completions",
      edit: "<gateway>/api/v1/edit/completions",
      transcriptions: "<gateway>/api/v1/audio/transcriptions",
    })
  })
})
