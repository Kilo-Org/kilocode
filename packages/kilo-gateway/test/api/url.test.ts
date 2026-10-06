import { describe, expect, test } from "bun:test"
import { resolveKiloApiRoot, resolveKiloGatewayBaseUrl, resolveKiloGatewayUrl } from "../../src/api/url"

describe("Kilo API root", () => {
  test("resolves the Kilo API root for endpoints outside the AI gateway", () => {
    expect(resolveKiloApiRoot()).toBe("https://api.kilo.ai/api/")
    expect(resolveKiloApiRoot({ baseURL: "http://localhost:3000/api/organizations/org" })).toBe(
      "http://localhost:3000/api/",
    )
    expect(resolveKiloApiRoot({ token: "https://token.test:opaque" })).toBe("https://token.test/api/")
  })
})

describe("Kilo AI Gateway base URL", () => {
  test("uses the production gateway without any override", () => {
    expect(resolveKiloGatewayBaseUrl()).toBe("https://ai-gateway.kilo.ai/api/v1/")
    expect(resolveKiloGatewayUrl("fim/completions")).toBe("https://ai-gateway.kilo.ai/api/v1/fim/completions")
  })

  test("derives /api/v1 from the Kilo API URL", () => {
    expect(resolveKiloGatewayBaseUrl({ api: "http://localhost:3000" })).toBe("http://localhost:3000/api/v1/")
    expect(resolveKiloGatewayBaseUrl({ api: "https://api.example.test/" })).toBe("https://api.example.test/api/v1/")
    expect(resolveKiloGatewayBaseUrl({ api: "https://example.test/dev" })).toBe("https://example.test/dev/api/v1/")
  })

  test("derives /api/v1 from a token URL or baseURL before KILO_API_URL", () => {
    expect(resolveKiloGatewayBaseUrl({ api: "https://api.example.test", token: "http://localhost:3000:opaque" })).toBe(
      "http://localhost:3000/api/v1/",
    )
    expect(resolveKiloGatewayBaseUrl({ api: "https://api.example.test", baseURL: "https://example.test" })).toBe(
      "https://example.test/api/v1/",
    )
  })

  test("replaces existing Kilo API routes in a baseURL", () => {
    expect(resolveKiloGatewayBaseUrl({ baseURL: "https://example.test/api/openrouter/?x=1#frag" })).toBe(
      "https://example.test/api/v1/",
    )
    expect(resolveKiloGatewayBaseUrl({ baseURL: "https://example.test/dev/api/organizations/org" })).toBe(
      "https://example.test/dev/api/v1/",
    )
    expect(resolveKiloGatewayBaseUrl({ baseURL: "https://ai-gateway.kilo.ai/api/v1" })).toBe(
      "https://ai-gateway.kilo.ai/api/v1/",
    )
  })

  test("uses an explicit gateway URL as given", () => {
    const gateway = "https://gateway.test/v1?x=1"
    expect(resolveKiloGatewayBaseUrl({ gateway, api: "https://api.example.test" })).toBe("https://gateway.test/v1/")
    expect(resolveKiloGatewayBaseUrl({ gateway, token: "http://localhost:3000:opaque" })).toBe(
      "https://gateway.test/v1/",
    )
    expect(resolveKiloGatewayBaseUrl({ gateway, baseURL: "https://gateway.test/v1/" })).toBe("https://gateway.test/v1/")
    expect(resolveKiloGatewayUrl("fim/completions", { gateway })).toBe("https://gateway.test/v1/fim/completions")
  })

  test("lets a baseURL elsewhere override an explicit gateway URL", () => {
    expect(resolveKiloGatewayBaseUrl({ gateway: "https://gateway.test/api/v1", baseURL: "https://example.test" })).toBe(
      "https://example.test/api/v1/",
    )
  })
})

describe("environment", () => {
  test.each([
    { mode: "only KILO_API_URL", ai: "api" },
    { mode: "both", ai: "gateway" },
  ])("routes AI endpoints with $mode set", async ({ mode, ai }) => {
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
      const gateway = ${JSON.stringify(mode)} === "both" ? serve("gateway") : api
      process.env.KILO_API_URL = "http://localhost:" + api.port
      if (gateway !== api) process.env.KILO_AI_GATEWAY_URL = "http://localhost:" + gateway.port + "/api/v1"
      else delete process.env.KILO_AI_GATEWAY_URL
      const kilo = await import(${JSON.stringify(Bun.resolveSync("../../src/index.ts", import.meta.dir))})
      const fim = await import(${JSON.stringify(Bun.resolveSync("../../src/fim.ts", import.meta.dir))})
      const edit = await import(${JSON.stringify(Bun.resolveSync("../../src/edit.ts", import.meta.dir))})
      const strip = (url) =>
        url.replace("http://localhost:" + gateway.port, "<ai>").replace("http://localhost:" + api.port, "<api>")
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
        transcriptions: strip(kilo.resolveKiloGatewayUrl("audio/transcriptions")),
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
        `${ai} /api/v1/models`,
        `${ai} /api/v1/organizations/org/models`,
        `${ai} /api/v1/transcription-models`,
        `${ai} /api/v1/embedding-models`,
        "api /api/defaults",
        `${ai} /api/v1/chat/completions`,
      ],
      openrouter: "<ai>/api/v1",
      fim: "<ai>/api/v1/fim/completions",
      edit: "<ai>/api/v1/edit/completions",
      transcriptions: "<ai>/api/v1/audio/transcriptions",
    })
  })
})
