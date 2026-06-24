import path from "node:path"
import { createHash } from "node:crypto"
import { describe, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { MAX_MANIFEST_BYTES, Marketplace, decodeManifest } from "@/kilocode/marketplace"
import { testEffect } from "../../lib/effect"
import { manifest, skillArchive, skillManifest } from "./fixture"

const endpoint = "https://marketplace.example.com/manifest.json"
const legacy = "https://marketplace.example.com/api/marketplace"
const release = "https://api.github.com/repos/Kilo-Org/kilo-marketplace/releases/tags/skills-latest"
const content = "https://github.com/Kilo-Org/kilo-marketplace/releases/download/skills-latest/demo-skill.tar.gz"
const object = "https://objects.githubusercontent.com/github-production-release-asset/demo-skill.tar.gz"
const base = Layer.mergeAll(AppFileSystem.defaultLayer, EffectFlock.defaultLayer)
const it = testEffect(base)

function http(handler: (request: HttpClientRequest.HttpClientRequest) => Response) {
  return HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler(request))))
}

function layer(cacheDir: string, client: HttpClient.HttpClient, url = endpoint) {
  return Marketplace.layer({ cacheDir, endpoint: url }).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
  )
}

function json(value: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  })
}

function yaml(value: string) {
  return new Response(value, { status: 200, headers: { "content-type": "text/yaml" } })
}

function legacySkills() {
  return `items:
  - id: demo-skill
    description: A fixture Skill
    category: development
    githubUrl: https://github.com/Kilo-Org/kilo-marketplace/tree/main/skills/demo-skill
    rawUrl: https://raw.githubusercontent.com/Kilo-Org/kilo-marketplace/main/skills/demo-skill/SKILL.md
    content: ${content}
`
}

function legacyMcps() {
  return `items:
  - id: context7
    name: Context7
    description: Up-to-date code documentation for LLMs
    author: upstash
    url: https://github.com/upstash/context7
    category: search
    content:
      - name: NPX
        prerequisites:
          - Node.js
        content: |
          {"command":"npx","args":["-y","@upstash/context7-mcp"],"env":{"DEFAULT_MINIMUM_TOKENS":"{{DEFAULT_MINIMUM_TOKENS}}"}}
        parameters:
          - name: Default Minimum Tokens
            key: DEFAULT_MINIMUM_TOKENS
            placeholder: "6000"
            optional: true
      - name: Remote Server
        content: |
          {"type":"streamable-http","url":"https://mcp.context7.com/mcp","headers":{"Authorization":"Bearer {{CONTEXT7_TOKEN}}"}}
        parameters:
          - name: Context7 Token
            key: CONTEXT7_TOKEN
  - id: cloudflare
    name: Cloudflare
    description: Cloudflare remote MCP fixture
    parameters:
      - name: Cloudflare API Token
        key: CLOUDFLARE_API_TOKEN
    content:
      - name: Remote MCP
        content: |
          {"type":"streamable-http","url":"https://mcp.cloudflare.com/mcp"}
      - name: Unsafe Headers
        content: |
          {"command":"npx","args":["-y","unsafe-mcp"],"env":{"OPENAPI_MCP_HEADERS":"{}"}}
  - id: unsafe-only
    name: Unsafe Only
    description: MCP fixture without a safe historical method
    content:
      - name: Unsafe Headers
        content: |
          {"command":"npx","args":["-y","unsafe-mcp"],"env":{"OPENAPI_MCP_HEADERS":"{}"}}
`
}

describe("Marketplace service", () => {
  it.live("persists a validated ETag cache and handles not-modified responses", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const root = yield* fs.makeTempDirectoryScoped()
      const cache = path.join(root, "cache")
      const seen: HttpClientRequest.HttpClientRequest[] = []
      const client = http((request) => {
        seen.push(request)
        if (seen.length === 1) return json(manifest(), { etag: '"revision-1"' })
        return new Response(null, { status: 304 })
      })

      const results = yield* Effect.gen(function* () {
        const marketplace = yield* Marketplace.Service
        const first = yield* marketplace.manifest()
        const second = yield* marketplace.manifest()
        return { first, second }
      }).pipe(Effect.provide(layer(cache, client)))

      expect(results.first.source).toBe("network")
      expect(results.second.source).toBe("cache-not-modified")
      expect(results.second.manifest.revision).toBe(results.first.manifest.revision)
      expect(seen[0].headers["if-none-match"]).toBeUndefined()
      expect(seen[1].headers["if-none-match"]).toBe('"revision-1"')
      const files = (yield* fs.readDirectoryEntries(cache)).filter((entry) => entry.name.endsWith(".json"))
      expect(files).toHaveLength(1)
    }),
  )

  it.live("upgrades a legacy cache without item history", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const root = yield* fs.makeTempDirectoryScoped()
      const cache = path.join(root, "cache")
      yield* Marketplace.Service.use((marketplace) => marketplace.manifest()).pipe(
        Effect.provide(
          layer(
            cache,
            http(() => json(manifest(), { etag: '"legacy"' })),
          ),
        ),
      )
      const entry = (yield* fs.readDirectoryEntries(cache)).find((item) => item.name.endsWith(".json"))
      if (!entry) return yield* Effect.die("missing cache fixture")
      const file = path.join(cache, entry.name)
      const legacy = JSON.parse(yield* fs.readFileString(file)) as Record<string, unknown>
      delete legacy.history
      yield* fs.writeFileString(file, `${JSON.stringify(legacy)}\n`)

      const result = yield* Marketplace.Service.use((marketplace) => marketplace.manifest()).pipe(
        Effect.provide(
          layer(
            cache,
            http(() => new Response(null, { status: 304 })),
          ),
        ),
      )
      expect(result.source).toBe("cache-not-modified")
      expect(String(result.manifest.revision)).toBe("2026-06-22.1")
    }),
  )

  it.live("uses last-known-good data when a fetched manifest is malformed", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const root = yield* fs.makeTempDirectoryScoped()
      const cache = path.join(root, "cache")
      const seed = http(() => json(manifest(), { etag: '"good"' }))
      yield* Marketplace.Service.use((marketplace) => marketplace.manifest()).pipe(Effect.provide(layer(cache, seed)))

      const broken = http(() => json({ version: 1, revision: "mutable", items: [] }))
      const result = yield* Marketplace.Service.use((marketplace) => marketplace.manifest()).pipe(
        Effect.provide(layer(cache, broken)),
      )
      expect(result.source).toBe("cache-fallback")
      expect(String(result.manifest.revision)).toBe("2026-06-22.1")
    }),
  )

  it.live("rejects rollback and same-version item mutation without replacing good data", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const root = yield* fs.makeTempDirectoryScoped()
      const cache = path.join(root, "cache")
      const initial = manifest()
      initial.revision = "2026-06-22.2"
      yield* Marketplace.Service.use((marketplace) => marketplace.manifest()).pipe(
        Effect.provide(
          layer(
            cache,
            http(() => json(initial)),
          ),
        ),
      )

      const stale = manifest()
      const fallback = yield* Marketplace.Service.use((marketplace) => marketplace.manifest()).pipe(
        Effect.provide(
          layer(
            cache,
            http(() => json(stale)),
          ),
        ),
      )
      expect(fallback.source).toBe("cache-fallback")
      expect(String(fallback.manifest.revision)).toBe("2026-06-22.2")

      const changed = manifest()
      changed.revision = "2026-06-22.3"
      changed.items[0].source_revision = "b".repeat(40)
      const immutable = yield* Marketplace.Service.use((marketplace) => marketplace.manifest()).pipe(
        Effect.provide(
          layer(
            cache,
            http(() => json(changed)),
          ),
        ),
      )
      expect(immutable.source).toBe("cache-fallback")
      expect(String(immutable.manifest.items[0].source_revision)).toBe("a".repeat(40))
    }),
  )

  it.live("keeps item-version tombstones across removal and rejects mutated reintroduction", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const root = yield* fs.makeTempDirectoryScoped()
      const cache = path.join(root, "cache")
      const initial = manifest()
      yield* Marketplace.Service.use((marketplace) => marketplace.manifest()).pipe(
        Effect.provide(
          layer(
            cache,
            http(() => json(initial)),
          ),
        ),
      )

      const removed = manifest()
      removed.revision = "2026-06-22.2"
      removed.items = []
      const empty = yield* Marketplace.Service.use((marketplace) => marketplace.manifest()).pipe(
        Effect.provide(
          layer(
            cache,
            http(() => json(removed)),
          ),
        ),
      )
      expect(empty.source).toBe("network")
      expect(empty.manifest.items).toEqual([])

      const changed = manifest()
      changed.revision = "2026-06-22.3"
      changed.items[0].source_revision = "b".repeat(40)
      const fallback = yield* Marketplace.Service.use((marketplace) => marketplace.manifest()).pipe(
        Effect.provide(
          layer(
            cache,
            http(() => json(changed)),
          ),
        ),
      )
      expect(fallback.source).toBe("cache-fallback")
      expect(fallback.manifest.items).toEqual([])
    }),
  )

  it.live("fails closed when no valid cache exists", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const root = yield* fs.makeTempDirectoryScoped()
      const error = yield* Marketplace.Service.use((marketplace) => Effect.flip(marketplace.manifest())).pipe(
        Effect.provide(
          layer(
            path.join(root, "cache"),
            http(() => json({ version: 1 })),
          ),
        ),
      )
      expect(error._tag).toBe("MarketplaceManifestError")
      if (error._tag === "MarketplaceManifestError") expect(error.reason).toBe("invalid_schema")
    }),
  )

  it.live("adapts historical YAML feeds and follows safe GitHub artifact redirects", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const project = yield* fs.makeTempDirectoryScoped()
      const cache = path.join(project, "cache")
      const bytes = skillArchive()
      const seen: string[] = []
      const client = http((request) => {
        seen.push(request.url)
        if (request.url === `${legacy}/skills`) return yaml(legacySkills())
        if (request.url === `${legacy}/mcps`) return yaml(legacyMcps())
        if (request.url === release) {
          return json({
            assets: [
              {
                name: "demo-skill.tar.gz",
                browser_download_url: content,
                size: bytes.byteLength,
                digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
              },
            ],
          })
        }
        if (request.url === content) return new Response(null, { status: 302, headers: { location: object } })
        if (request.url === object) return new Response(bytes, { status: 200 })
        return new Response("missing", { status: 404 })
      })

      const result = yield* Marketplace.Service.use((marketplace) => marketplace.manifest()).pipe(
        Effect.provide(layer(cache, client, legacy)),
      )
      expect(result.source).toBe("network")
      expect(String(result.manifest.revision)).toMatch(/^sha256:[0-9a-f]{64}$/)

      const skill = result.manifest.items.find((item) => item.kind === "skill" && item.id === "demo-skill")
      if (!skill || skill.kind !== "skill" || !skill.artifact) return yield* Effect.die("missing Skill")
      expect(skill.version).toBeUndefined()
      expect(String(skill.artifact.url)).toBe(content)

      const mcp = result.manifest.items.find((item) => item.kind === "mcp" && item.id === "context7")
      if (!mcp || mcp.kind !== "mcp") return yield* Effect.die("missing MCP")
      expect(mcp.methods.map((method) => String(method.id))).toEqual(["npx", "remote-server"])
      const resolved = yield* Marketplace.Service.use((marketplace) =>
        marketplace.resolveMcp({ item: mcp, method: "remote-server" }),
      ).pipe(Effect.provide(layer(cache, client, legacy)))
      expect(resolved).toMatchObject({
        type: "remote",
        url: "https://mcp.context7.com/mcp",
        headers: { Authorization: "Bearer {env:CONTEXT7_TOKEN}" },
        enabled: false,
      })

      const cloudflare = result.manifest.items.find((item) => item.kind === "mcp" && item.id === "cloudflare")
      if (!cloudflare || cloudflare.kind !== "mcp") return yield* Effect.die("missing Cloudflare MCP")
      expect(cloudflare.methods.map((method) => String(method.id))).toEqual(["remote-mcp"])
      expect(cloudflare.methods[0].parameters).toEqual([])
      expect(cloudflare.methods[0].auth).toEqual({ mode: "none" })

      const unsafe = result.manifest.items.find((item) => item.kind === "mcp" && item.id === "unsafe-only")
      if (!unsafe || unsafe.kind !== "mcp") return yield* Effect.die("missing unsafe MCP")
      expect(unsafe.methods).toEqual([])
      expect(unsafe.installability).toEqual({
        installable: false,
        reason: "Marketplace MCP has no safe installation methods.",
      })

      const installed = yield* Marketplace.Service.use((marketplace) => marketplace.installSkill(project, skill)).pipe(
        Effect.provide(layer(cache, client, legacy)),
      )
      expect(installed.version).toBeUndefined()
      expect(yield* fs.isFile(installed.skill)).toBe(true)
      expect(seen).toContain(content)
      expect(seen).toContain(object)
    }),
  )

  it.live("rejects oversized manifest responses before decoding", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const root = yield* fs.makeTempDirectoryScoped()
      const client = http(
        () => new Response("{}", { status: 200, headers: { "content-length": String(MAX_MANIFEST_BYTES + 1) } }),
      )
      const error = yield* Marketplace.Service.use((marketplace) => Effect.flip(marketplace.manifest())).pipe(
        Effect.provide(layer(path.join(root, "cache"), client)),
      )
      expect(error._tag).toBe("MarketplaceManifestError")
      if (error._tag === "MarketplaceManifestError") expect(error.reason).toBe("body_too_large")
    }),
  )

  it.live("downloads, verifies, stages, and installs a Skill artifact", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const project = yield* fs.makeTempDirectoryScoped()
      const bytes = skillArchive()
      const decoded = yield* decodeManifest(skillManifest(bytes))
      const item = decoded.items[0]
      if (item.kind !== "skill") return yield* Effect.die("expected Skill fixture")
      const client = http(
        () =>
          new Response(bytes, {
            status: 200,
            headers: { "content-length": String(bytes.byteLength), "content-type": "application/gzip" },
          }),
      )

      const installed = yield* Marketplace.Service.use((marketplace) => marketplace.installSkill(project, item)).pipe(
        Effect.provide(layer(path.join(project, "cache"), client)),
      )
      expect(installed.path).toBe(path.join(project, ".kilo", "skills", "demo-skill"))
      expect(yield* fs.isFile(installed.skill)).toBe(true)
    }),
  )

  it.live("rejects downloaded bytes that do not match the immutable digest", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const project = yield* fs.makeTempDirectoryScoped()
      const bytes = skillArchive()
      const changed = Uint8Array.from(bytes)
      changed[changed.byteLength - 1] ^= 1
      const decoded = yield* decodeManifest(skillManifest(bytes))
      const item = decoded.items[0]
      if (item.kind !== "skill") return yield* Effect.die("expected Skill fixture")
      const client = http(() => new Response(changed, { status: 200 }))

      const error = yield* Marketplace.Service.use((marketplace) =>
        Effect.flip(marketplace.installSkill(project, item)),
      ).pipe(Effect.provide(layer(path.join(project, "cache"), client)))
      expect(error._tag).toBe("SkillIntegrityError")
      if (error._tag === "SkillIntegrityError") expect(error.reason).toBe("digest")
      expect(yield* fs.existsSafe(path.join(project, ".kilo", "skills", "demo-skill"))).toBe(false)
    }),
  )

  it.live("bounds Skill downloads to the signed artifact size", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const project = yield* fs.makeTempDirectoryScoped()
      const bytes = skillArchive()
      const oversized = new Uint8Array(bytes.byteLength + 1)
      oversized.set(bytes)
      const decoded = yield* decodeManifest(skillManifest(bytes))
      const item = decoded.items[0]
      if (item.kind !== "skill") return yield* Effect.die("expected Skill fixture")
      const client = http(() => new Response(oversized, { status: 200 }))

      const error = yield* Marketplace.Service.use((marketplace) =>
        Effect.flip(marketplace.installSkill(project, item)),
      ).pipe(Effect.provide(layer(path.join(project, "cache"), client)))
      expect(error._tag).toBe("SkillDownloadError")
      if (error._tag === "SkillDownloadError") expect(error.reason).toBe("body_too_large")
    }),
  )

  it.live("disables fetch redirect following for manifest requests", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const root = yield* fs.makeTempDirectoryScoped()
      const seen: RequestInit[] = []
      const fetch = Object.assign(
        (_input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
          seen.push(init ?? {})
          return Promise.resolve(json(manifest()))
        },
        { preconnect: globalThis.fetch.preconnect },
      )
      const market = Marketplace.layer({ cacheDir: path.join(root, "cache"), endpoint }).pipe(
        Layer.provide(FetchHttpClient.layer),
      )
      yield* Marketplace.Service.use((marketplace) => marketplace.manifest()).pipe(
        Effect.provide(market),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      )
      expect(seen).toHaveLength(1)
      expect(seen[0].redirect).toBe("error")
    }),
  )

  it.live("rejects manifest and artifact redirect responses without following them", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const project = yield* fs.makeTempDirectoryScoped()
      const redirected: string[] = []
      const client = http((request) => {
        redirected.push(request.url)
        return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/internal" } })
      })
      const manifestError = yield* Marketplace.Service.use((marketplace) => Effect.flip(marketplace.manifest())).pipe(
        Effect.provide(layer(path.join(project, "manifest-cache"), client)),
      )
      expect(manifestError._tag).toBe("MarketplaceUnavailableError")
      expect(redirected).toEqual([endpoint])

      const bytes = skillArchive()
      const decoded = yield* decodeManifest(skillManifest(bytes))
      const item = decoded.items[0]
      if (item.kind !== "skill" || !item.artifact) return yield* Effect.die("expected Skill fixture")
      const artifactError = yield* Marketplace.Service.use((marketplace) =>
        Effect.flip(marketplace.installSkill(project, item)),
      ).pipe(Effect.provide(layer(path.join(project, "artifact-cache"), client)))
      expect(artifactError._tag).toBe("SkillDownloadError")
      expect(redirected).toEqual([endpoint, item.artifact.url])
      expect(yield* fs.existsSafe(path.join(project, ".kilo", "skills", item.id))).toBe(false)
    }),
  )

  it.live("rejects insecure non-loopback Marketplace endpoints before HTTP", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const root = yield* fs.makeTempDirectoryScoped()
      const client = HttpClient.make((request) => Effect.die(`unexpected request: ${request.url}`))
      const error = yield* Marketplace.Service.use((marketplace) => Effect.flip(marketplace.manifest())).pipe(
        Effect.provide(layer(path.join(root, "cache"), client, "http://marketplace.example.com/manifest.json")),
      )
      expect(error._tag).toBe("MarketplaceEndpointError")
      if (error._tag === "MarketplaceEndpointError") expect(error.reason).toBe("insecure_url")
    }),
  )
})
