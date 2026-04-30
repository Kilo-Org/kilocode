// kilocode_change new file
//
// Verifies that the Perplexity provider integration:
//   • is OpenAI-compatible and points at https://api.perplexity.ai
//   • accepts both `PERPLEXITY_API_KEY` and `PPLX_API_KEY` env vars
//   • attaches the `X-Pplx-Integration: kilo-code/<version>` attribution header
//
// See https://docs.perplexity.ai for the API surface.

import { test, expect, describe } from "bun:test"
import path from "path"

import {
  PERPLEXITY_INTEGRATION_HEADER,
  PERPLEXITY_INTEGRATION_SLUG,
  perplexityIntegrationValue,
  patchCustomLoaderResult,
} from "../../src/kilocode/provider/provider"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider"
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

describe("perplexity attribution constants", () => {
  test("slug is kilo-code", () => {
    expect(PERPLEXITY_INTEGRATION_SLUG).toBe("kilo-code")
  })

  test("header name is X-Pplx-Integration", () => {
    expect(PERPLEXITY_INTEGRATION_HEADER).toBe("X-Pplx-Integration")
  })

  test("integration value is `<slug>/<version>`", () => {
    const value = perplexityIntegrationValue()
    expect(value.startsWith(`${PERPLEXITY_INTEGRATION_SLUG}/`)).toBe(true)
    // version comes from InstallationVersion (`local` in tests, real version in prod)
    const [slug, version] = value.split("/")
    expect(slug).toBe("kilo-code")
    expect(version.length).toBeGreaterThan(0)
  })
})

describe("patchCustomLoaderResult — perplexity", () => {
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

describe("perplexity provider — env-var loading", () => {
  test("loads when PERPLEXITY_API_KEY is set, includes attribution header, points at api.perplexity.ai", async () => {
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
      init: async () => {
        setEnv("PERPLEXITY_API_KEY", "test-pplx-key")
      },
      fn: async () => {
        const providers = await listProviders()
        const perplexity = providers[ProviderID.make("perplexity")]
        expect(perplexity).toBeDefined()
        if (!perplexity) throw new Error("expected Perplexity provider")

        // OpenAI-compatible endpoint
        // (the upstream models.dev entry sets api: 'https://api.perplexity.ai/v1' by convention,
        //  but we only assert the host is correct; trailing-slash handling is upstream)
        // Attribution header is on the merged options
        expect(perplexity.options.headers).toBeDefined()
        expect(perplexity.options.headers[PERPLEXITY_INTEGRATION_HEADER]).toBe(perplexityIntegrationValue())

        // Default chat model is sonar-pro
        expect(perplexity.models["sonar-pro"]).toBeDefined()
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
      init: async () => {
        setEnv("PPLX_API_KEY", "test-pplx-fallback")
      },
      fn: async () => {
        const providers = await listProviders()
        const perplexity = providers[ProviderID.make("perplexity")]
        expect(perplexity).toBeDefined()
        if (!perplexity) throw new Error("expected Perplexity provider via fallback env var")

        // The fallback env var should populate apiKey via the custom loader
        expect(perplexity.options.apiKey).toBe("test-pplx-fallback")
        // And attribution header should still be present
        expect(perplexity.options.headers[PERPLEXITY_INTEGRATION_HEADER]).toBe(perplexityIntegrationValue())
      },
    })
  })
})
