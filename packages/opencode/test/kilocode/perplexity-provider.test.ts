// kilocode_change new file
//
// Verifies that the Perplexity provider integration:
//   • is positioned as the Perplexity *Agent API* (an OpenRouter-style alternative
//     in Kilo Code) — not a Sonar search/answer endpoint
//   • is OpenAI-compatible and pinned to https://api.perplexity.ai
//   • accepts both `PERPLEXITY_API_KEY` and `PPLX_API_KEY` env vars
//   • defaults to `gpt-5.5` (the routed Agent-API model)
//   • attaches the `X-Pplx-Integration: kilo-code/<version>` attribution header
//
// See https://docs.perplexity.ai for the API surface.

import { test, expect, describe } from "bun:test"
import path from "path"

import {
  PERPLEXITY_INTEGRATION_HEADER,
  PERPLEXITY_INTEGRATION_SLUG,
  PERPLEXITY_API_BASE_URL,
  PERPLEXITY_DEFAULT_MODEL,
  perplexityIntegrationValue,
  patchCustomLoaderResult,
} from "../../src/kilocode/provider/provider"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "@/provider/provider"
import { ProviderID } from "../../src/provider/schema"
import { Env } from "../../src/env"
import { makeRuntime } from "../../src/effect/run-service"
import { Effect } from "effect"
import { AppRuntime } from "../../src/effect/app-runtime"

const env = makeRuntime(Env.Service, Env.defaultLayer)
const setEnv = (k: string, v: string) => env.runSync((svc) => svc.set(k, v))

async function listProviders() {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      return yield* provider.list()
    }),
  )
}

describe("perplexity Agent API — positioning constants", () => {
  test("slug is kilo-code", () => {
    expect(PERPLEXITY_INTEGRATION_SLUG).toBe("kilo-code")
  })

  test("header name is X-Pplx-Integration", () => {
    expect(PERPLEXITY_INTEGRATION_HEADER).toBe("X-Pplx-Integration")
  })

  test("base URL is the Agent API host", () => {
    expect(PERPLEXITY_API_BASE_URL).toBe("https://api.perplexity.ai")
  })

  test("default model is gpt-5.5 (Agent API)", () => {
    expect(PERPLEXITY_DEFAULT_MODEL).toBe("gpt-5.5")
  })

  test("integration value is `<slug>/<version>`", () => {
    const value = perplexityIntegrationValue()
    expect(value.startsWith(`${PERPLEXITY_INTEGRATION_SLUG}/`)).toBe(true)
    const [slug, version] = value.split("/")
    expect(slug).toBe("kilo-code")
    expect(version.length).toBeGreaterThan(0)
  })
})

describe("patchCustomLoaderResult — perplexity attribution header", () => {
  test("injects the X-Pplx-Integration header onto the options", () => {
    const result = { options: {} as Record<string, any> }
    patchCustomLoaderResult("perplexity", result, {})
    expect(result.options.headers).toBeDefined()
    expect(result.options.headers![PERPLEXITY_INTEGRATION_HEADER]).toBe(perplexityIntegrationValue())
  })

  test("preserves any existing headers", () => {
    const result = { options: { headers: { "X-Existing": "foo" } } as Record<string, any> }
    patchCustomLoaderResult("perplexity", result, {})
    expect(result.options.headers!["X-Existing"]).toBe("foo")
    expect(result.options.headers![PERPLEXITY_INTEGRATION_HEADER]).toBe(perplexityIntegrationValue())
  })

  test("is a no-op when options is missing", () => {
    const result: { options?: Record<string, any> } = {}
    patchCustomLoaderResult("perplexity", result, {})
    expect(result.options).toBeUndefined()
  })
})

describe("perplexity Agent API — env-var loading and default model", () => {
  test("loads when PERPLEXITY_API_KEY is set; baseURL=api.perplexity.ai; default model gpt-5.5", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://app.kilo.ai/config.json",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      init: Effect.promise(async () => {
        setEnv("PERPLEXITY_API_KEY", "test-pplx-key")
      }).pipe(Effect.asVoid),
      fn: async () => {
        const providers = await listProviders()
        const perplexity = providers[ProviderID.make("perplexity")]
        expect(perplexity).toBeDefined()
        if (!perplexity) throw new Error("expected Perplexity provider")

        // Pinned Agent API endpoint
        expect(perplexity.options.baseURL).toBe(PERPLEXITY_API_BASE_URL)

        // Attribution header is on the merged options
        expect(perplexity.options.headers).toBeDefined()
        expect(perplexity.options.headers[PERPLEXITY_INTEGRATION_HEADER]).toBe(perplexityIntegrationValue())

        // Default model — gpt-5.5 routed through the Agent API.
        expect(perplexity.models[PERPLEXITY_DEFAULT_MODEL]).toBeDefined()
        expect(perplexity.models[PERPLEXITY_DEFAULT_MODEL].api.url).toBe(PERPLEXITY_API_BASE_URL)
      },
    })
  })

  test("loads from PPLX_API_KEY fallback when PERPLEXITY_API_KEY is unset", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://app.kilo.ai/config.json",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      init: Effect.promise(async () => {
        setEnv("PPLX_API_KEY", "test-pplx-fallback")
      }).pipe(Effect.asVoid),
      fn: async () => {
        const providers = await listProviders()
        const perplexity = providers[ProviderID.make("perplexity")]
        expect(perplexity).toBeDefined()
        if (!perplexity) throw new Error("expected Perplexity provider via fallback env var")

        // The fallback env var should populate apiKey via the custom loader
        expect(perplexity.options.apiKey).toBe("test-pplx-fallback")
        // baseURL is still pinned to the Agent API host
        expect(perplexity.options.baseURL).toBe(PERPLEXITY_API_BASE_URL)
        // And attribution header should still be present
        expect(perplexity.options.headers[PERPLEXITY_INTEGRATION_HEADER]).toBe(perplexityIntegrationValue())
        // gpt-5.5 is the routed default
        expect(perplexity.models[PERPLEXITY_DEFAULT_MODEL]).toBeDefined()
      },
    })
  })
})
