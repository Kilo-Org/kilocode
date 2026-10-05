import { describe, expect, test } from "bun:test"
import {
  resolveKiloAiGatewayRoot,
  resolveKiloAiGatewayUrl,
  resolveKiloApiRoot,
  resolveKiloGatewayBaseUrl,
  resolveKiloOpenRouterBaseUrl,
} from "../../src/api/url"

describe("Kilo API URL resolvers", () => {
  test("resolves the Kilo API root for endpoints outside the AI gateway", () => {
    expect(resolveKiloApiRoot()).toBe("https://api.kilo.ai/api/")
    expect(resolveKiloApiRoot({ baseURL: "http://localhost:3000/api/organizations/org" })).toBe(
      "http://localhost:3000/api/",
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

describe("Kilo AI Gateway URL resolvers", () => {
  test("defaults to the production gateway", () => {
    expect(resolveKiloAiGatewayRoot()).toBe("https://ai-gateway.kilo.ai/api/v1/")
    expect(resolveKiloGatewayBaseUrl()).toBe("https://ai-gateway.kilo.ai/api/v1/")
    expect(resolveKiloOpenRouterBaseUrl()).toBe("https://ai-gateway.kilo.ai/api/v1/")
    expect(resolveKiloAiGatewayUrl("fim/completions", "/api/fim/completions")).toBe(
      "https://ai-gateway.kilo.ai/api/v1/fim/completions",
    )
  })

  test("uses the production gateway for api.kilo.ai base URLs", () => {
    expect(resolveKiloOpenRouterBaseUrl({ baseURL: "https://api.kilo.ai/api/organizations/org" })).toBe(
      "https://ai-gateway.kilo.ai/api/v1/",
    )
  })

  test("infers the local ai-gateway app at the web port + 10 for a localhost Kilo API URL", () => {
    expect(resolveKiloAiGatewayRoot({ api: "http://localhost:3000" })).toBe("http://localhost:3010/api/v1/")
    expect(resolveKiloAiGatewayRoot({ api: "http://localhost:3100/" })).toBe("http://localhost:3110/api/v1/")
    expect(resolveKiloAiGatewayRoot({ api: "http://127.0.0.1:3005" })).toBe("http://127.0.0.1:3015/api/v1/")
    expect(resolveKiloAiGatewayRoot({ api: "http://[::1]:3000" })).toBe("http://[::1]:3010/api/v1/")
    expect(resolveKiloAiGatewayRoot({ api: "http://localhost" })).toBe("http://localhost:3010/api/v1/")
    expect(resolveKiloAiGatewayRoot({ token: "http://localhost:3000:opaque" })).toBe("http://localhost:3010/api/v1/")
  })

  test("keeps base URLs that already point at a gateway", () => {
    expect(resolveKiloAiGatewayRoot({ baseURL: "http://localhost:3010/api/v1" })).toBe("http://localhost:3010/api/v1/")
    expect(resolveKiloAiGatewayRoot({ baseURL: "https://ai-gateway.kilo.ai/api/v1/" })).toBe(
      "https://ai-gateway.kilo.ai/api/v1/",
    )
  })

  test("keeps the legacy routes on other hosts", () => {
    expect(resolveKiloAiGatewayRoot({ baseURL: "https://example.test" })).toBeUndefined()
    expect(resolveKiloAiGatewayRoot({ token: "https://token.test:opaque" })).toBeUndefined()
    expect(resolveKiloAiGatewayRoot({ api: "https://staging.example.test" })).toBeUndefined()
  })

  test("only infers the local gateway for the Kilo API URL, not a custom localhost baseURL", () => {
    expect(resolveKiloAiGatewayRoot({ api: "http://localhost:3000" })).toBe("http://localhost:3010/api/v1/")
    expect(resolveKiloAiGatewayRoot({ api: "http://localhost:3000", baseURL: "http://localhost:3000/api/x" })).toBe(
      "http://localhost:3010/api/v1/",
    )
    expect(resolveKiloAiGatewayRoot({ baseURL: "http://127.0.0.1:4000" })).toBeUndefined()
    expect(resolveKiloOpenRouterBaseUrl({ baseURL: "http://127.0.0.1:4000" })).toBe(
      "http://127.0.0.1:4000/api/openrouter/",
    )
  })

  test("uses an explicit gateway base URL as-is", () => {
    const gateway = "https://gateway.test/custom/api/v1?x=1"
    expect(resolveKiloAiGatewayRoot({ gateway })).toBe("https://gateway.test/custom/api/v1/")
    expect(resolveKiloAiGatewayUrl("fim/completions", "/api/fim/completions", { gateway })).toBe(
      "https://gateway.test/custom/api/v1/fim/completions",
    )
  })

  test("prefers an explicit gateway over a token-derived URL and Kilo base URLs", () => {
    const gateway = "https://gateway.test/api/v1"
    expect(resolveKiloOpenRouterBaseUrl({ gateway, token: "http://localhost:3000:opaque" })).toBe(
      "https://gateway.test/api/v1/",
    )
    expect(resolveKiloOpenRouterBaseUrl({ gateway, baseURL: "https://gateway.test/api/v1/" })).toBe(
      "https://gateway.test/api/v1/",
    )
    expect(resolveKiloOpenRouterBaseUrl({ gateway, baseURL: "https://api.kilo.ai/api/openrouter" })).toBe(
      "https://gateway.test/api/v1/",
    )
  })

  test("keeps an explicit custom baseURL on its legacy routes", () => {
    const options = { gateway: "https://gateway.test/api/v1", baseURL: "https://example.test" }
    expect(resolveKiloAiGatewayRoot(options)).toBeUndefined()
    expect(resolveKiloGatewayBaseUrl(options)).toBe("https://example.test/api/gateway/")
    expect(resolveKiloOpenRouterBaseUrl(options)).toBe("https://example.test/api/openrouter/")
  })
})

describe("KILO_AI_GATEWAY_URL", () => {
  test.each(["explicit", "inferred"])(
    "routes AI endpoints to the %s gateway and other cloud endpoints to KILO_API_URL",
    async (mode) => {
      const script = `
      const seen = []
      const serve = (name, port) => Bun.serve({
        port,
        fetch(req) {
          seen.push(name + " " + new URL(req.url).pathname)
          return Response.json({ data: [], defaultModel: "test/model" })
        },
      })
      const servers = () => {
        if (${JSON.stringify(mode)} === "explicit") return { api: serve("api", 0), gateway: serve("gateway", 0) }
        // The inferred local gateway listens on the web port + 10.
        for (;;) {
          const api = serve("api", 0)
          try {
            return { api, gateway: serve("gateway", api.port + 10) }
          } catch {
            api.stop(true)
          }
        }
      }
      const { api, gateway } = servers()
      process.env.KILO_API_URL = "http://localhost:" + api.port
      if (${JSON.stringify(mode)} === "explicit") process.env.KILO_AI_GATEWAY_URL = "http://localhost:" + gateway.port + "/api/v1"
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
    },
  )
})
