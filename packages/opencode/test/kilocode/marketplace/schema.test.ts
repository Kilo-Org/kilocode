import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { MAX_ARTIFACT_BYTES, decodeManifest } from "@/kilocode/marketplace"
import { testEffect } from "../../lib/effect"
import { localManifest, manifest, skillArchive, skillManifest } from "./fixture"

const it = testEffect(Layer.empty)

describe("Marketplace manifest", () => {
  it.effect("decodes immutable install-ready resources", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeManifest(manifest())
      expect(decoded.version).toBe(1)
      expect(String(decoded.revision)).toBe("2026-06-22.1")
      expect(String(decoded.items[0].id)).toBe("example-mcp")
    }),
  )

  it.effect("accepts observed legacy revisions and rejects insecure source URLs", () =>
    Effect.gen(function* () {
      const legacy = manifest()
      legacy.revision = `sha256:${"9".repeat(64)}`
      const item = legacy.items[0] as Record<string, unknown>
      delete item.version
      delete item.source_revision
      const decoded = yield* decodeManifest(legacy)
      expect(String(decoded.revision)).toBe(`sha256:${"9".repeat(64)}`)
      expect(decoded.items[0].version).toBeUndefined()

      const insecure = manifest()
      insecure.items[0].source_url = "http://example.com/source"
      const source = yield* Effect.flip(decodeManifest(insecure))
      expect(source.reason).toBe("invalid_schema")

      const credential = manifest()
      credential.items[0].source_url = "https://user:password@example.com/source"
      const embedded = yield* Effect.flip(decodeManifest(credential))
      expect(embedded.reason).toBe("invalid_schema")
    }),
  )

  it.effect("rejects duplicate kind-qualified IDs", () =>
    Effect.gen(function* () {
      const value = manifest()
      value.items.push(value.items[0])
      const error = yield* Effect.flip(decodeManifest(value))
      expect(error.reason).toBe("duplicate_item")
      expect(error.item).toBe("mcp:example-mcp")
    }),
  )

  it.effect("requires HTTPS, digest, size, and explicit Skill installability", () =>
    Effect.gen(function* () {
      const bytes = skillArchive()
      const value = skillManifest(bytes, "http://downloads.example.com/demo.tar.gz")
      const insecure = yield* Effect.flip(decodeManifest(value))
      expect(insecure.reason).toBe("invalid_schema")

      const valid = skillManifest(bytes)
      const missing = {
        ...valid,
        items: valid.items.map((item) => ({ ...item, artifact: undefined })),
      }
      const artifact = yield* Effect.flip(decodeManifest(missing))
      expect(artifact.reason).toBe("invalid_installability")

      const oversized = skillManifest(bytes)
      oversized.items[0].artifact.size = MAX_ARTIFACT_BYTES + 1
      const size = yield* Effect.flip(decodeManifest(oversized))
      expect(size.reason).toBe("invalid_schema")
    }),
  )

  it.effect("validates declared trust, maturity, and installability", () =>
    Effect.gen(function* () {
      const trust = manifest()
      trust.items[0].publisher.trust = "unknown"
      const publisher = yield* Effect.flip(decodeManifest(trust))
      expect(publisher.reason).toBe("invalid_schema")

      const unsupported = manifest()
      unsupported.items[0].maturity = "unsupported"
      const maturity = yield* Effect.flip(decodeManifest(unsupported))
      expect(maturity.reason).toBe("invalid_installability")

      const unavailable = manifest()
      unavailable.items[0].installability = { installable: false }
      const reason = yield* Effect.flip(decodeManifest(unavailable))
      expect(reason.reason).toBe("invalid_installability")
    }),
  )

  it.effect("rejects raw sensitive template values and mutable enabled state", () =>
    Effect.gen(function* () {
      const header = manifest()
      header.items[0].methods[0].template.headers.Authorization = "Bearer raw-token"
      const raw = yield* Effect.flip(decodeManifest(header))
      expect(raw.reason).toBe("unsafe_template")

      const query = manifest()
      query.items[0].methods[0].template.url = "https://mcp.example.com/{param:workspace}?token=raw-token"
      const secret = yield* Effect.flip(decodeManifest(query))
      expect(secret.reason).toBe("unsafe_template")

      const local = localManifest()
      local.items[0].methods[0].template.environment.MCP_TOKEN = "raw-token"
      const environment = yield* Effect.flip(decodeManifest(local))
      expect(environment.reason).toBe("unsafe_template")

      const enabled = manifest()
      enabled.items[0].methods[0].template.enabled = true
      const state = yield* Effect.flip(decodeManifest(enabled))
      expect(state.reason).toBe("invalid_schema")
    }),
  )

  it.effect("rejects raw sensitive defaults and undeclared environment references", () =>
    Effect.gen(function* () {
      const valid = manifest()
      const method = valid.items[0].methods[0]
      const secret = {
        ...valid,
        items: [
          {
            ...valid.items[0],
            methods: [
              {
                ...method,
                parameters: [method.parameters[0], { ...method.parameters[1], default: "raw-token" }],
              },
            ],
          },
        ],
      }
      const raw = yield* Effect.flip(decodeManifest(secret))
      expect(raw.reason).toBe("invalid_parameter")

      const undeclared = manifest()
      undeclared.items[0].methods[0].template.headers.Authorization = "Bearer {env:OTHER_TOKEN}"
      const env = yield* Effect.flip(decodeManifest(undeclared))
      expect(env.reason).toBe("unsafe_template")
    }),
  )
})
