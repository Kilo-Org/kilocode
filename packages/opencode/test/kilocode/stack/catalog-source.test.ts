import { describe, expect, test } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { builtin } from "@/kilocode/stack/catalog"
import { CatalogSource } from "@/kilocode/stack/catalog/source"
import { Planner } from "@/kilocode/stack/planner"
import { Stack } from "@/kilocode/stack/schema"
import { testEffect } from "../../lib/effect"

const base = Layer.mergeAll(AppFileSystem.defaultLayer, EffectFlock.defaultLayer)
const it = testEffect(base)

function servedJson(revision = "9999-12-31.1"): string {
  return JSON.stringify({ ...builtin, revision: Stack.Revision.make(revision) })
}

function fakeHttp(handler: (req: HttpClientRequest.HttpClientRequest) => Response) {
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((req) => Effect.succeed(HttpClientResponse.fromWeb(req, handler(req)))),
  )
}

function sourceLayer(responseBody: string | null, status = 200) {
  const url = "https://test.example.com/stack.json"
  return CatalogSource.layer({ endpoint: url, cacheDir: `/tmp/catalog-source-test-${Date.now()}` }).pipe(
    Layer.provide(
      fakeHttp(() =>
        new Response(responseBody, {
          status,
          headers: responseBody ? { "content-type": "application/json" } : {},
        }),
      ),
    ),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(EffectFlock.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
  )
}

describe("CatalogSource", () => {
  it.live("snapshotLayer always returns the bundled fallback", () =>
    Effect.gen(function* () {
      const source = yield* CatalogSource.Service
      const result = yield* source.get()
      expect(result.origin).toBe("fallback")
      expect(result.catalog).toBe(builtin)
    }).pipe(Effect.provide(CatalogSource.snapshotLayer)),
  )

  it.live("uses fallback when the served catalog is unavailable (503)", () =>
    Effect.gen(function* () {
      const source = yield* CatalogSource.Service
      const result = yield* source.get()
      expect(result.origin).toBe("fallback")
    }).pipe(Effect.provide(sourceLayer(null, 503))),
  )

  it.live("uses fallback when the served catalog is malformed JSON", () =>
    Effect.gen(function* () {
      const source = yield* CatalogSource.Service
      const result = yield* source.get()
      expect(result.origin).toBe("fallback")
    }).pipe(Effect.provide(sourceLayer("{not: valid json"))),
  )

  it.live("prefers a served catalog whose revision is newer than the snapshot", () =>
    Effect.gen(function* () {
      const source = yield* CatalogSource.Service
      const result = yield* source.get()
      expect(result.origin).toBe("served")
      expect(String(result.catalog.revision)).toBe("9999-12-31.1")
    }).pipe(Effect.provide(sourceLayer(servedJson("9999-12-31.1")))),
  )

  it.live("falls back to snapshot when the served catalog has an older revision", () =>
    Effect.gen(function* () {
      const source = yield* CatalogSource.Service
      const result = yield* source.get()
      expect(result.origin).toBe("fallback")
      expect(result.catalog.revision).toBe(builtin.revision)
    }).pipe(Effect.provide(sourceLayer(servedJson("2000-01-01.1")))),
  )
})

describe("Trust policy", () => {
  test("advisory (curated:false) associations never contribute default=true via planner.resolve", () => {
    // Build a catalog that has one advisory association with default:true on a defaultable resource.
    const tech = Stack.TechnologyID.make("snowflake")
    const ref = Stack.ResourceRef.make("mcp:snowflake-managed")
    const advisory: Stack.Association = {
      ref,
      default: true, // advisory declares itself as default — must be ignored
      curated: false,
      trust: "official",
      maturity: "stable",
      source: Stack.Source.make("https://docs.snowflake.com"),
      rationale: "advisory association",
      warnings: [],
    }
    // Use only the advisory technology in a minimal catalog
    const catalog: Stack.Catalog = {
      ...builtin,
      verticals: [
        {
          id: Stack.VerticalID.make("data"),
          name: "Data Engineering",
          technologies: [{ id: tech, name: "Snowflake", resources: [advisory] }],
          categories: [
            {
              id: Stack.CategoryID.make("data-warehousing"),
              name: "Data Warehousing",
              technologies: [{ technology: tech }],
              categories: [],
            },
          ],
        },
      ],
    }
    const draft: Stack.Draft = {
      verticals: { data: { technologies: ["snowflake"] } } as unknown as Stack.Draft["verticals"],
      resources: {},
    }
    const resolution = Planner.resolve(catalog, draft)
    const resolved = resolution.resources.find((r) => r.ref === ref)
    expect(resolved, "resource should appear in resolution as a candidate").toBeDefined()
    expect(resolved?.default, "advisory cannot make resource default").toBe(false)
    expect(resolved?.enabled, "advisory cannot enable resource by default").toBe(false)
  })

  test("curated associations with default:true on defaultable resources set group default", () => {
    const tech = Stack.TechnologyID.make("snowflake")
    const ref = Stack.ResourceRef.make("mcp:snowflake-managed")
    const curated: Stack.Association = {
      ref,
      default: true,
      curated: true, // Kilo-curated
      trust: "official",
      maturity: "stable",
      source: Stack.Source.make("https://docs.snowflake.com"),
      rationale: "curated default MCP",
      warnings: [],
    }
    const catalog: Stack.Catalog = {
      ...builtin,
      verticals: [
        {
          id: Stack.VerticalID.make("data"),
          name: "Data Engineering",
          technologies: [{ id: tech, name: "Snowflake", resources: [curated] }],
          categories: [
            {
              id: Stack.CategoryID.make("data-warehousing"),
              name: "Data Warehousing",
              technologies: [{ technology: tech }],
              categories: [],
            },
          ],
        },
      ],
    }
    const draft: Stack.Draft = {
      verticals: { data: { technologies: ["snowflake"] } } as unknown as Stack.Draft["verticals"],
      resources: {},
    }
    const resolution = Planner.resolve(catalog, draft)
    const resolved = resolution.resources.find((r) => r.ref === ref)
    expect(resolved).toBeDefined()
    expect(resolved?.default).toBe(true)
    expect(resolved?.enabled).toBe(true)
  })
})
