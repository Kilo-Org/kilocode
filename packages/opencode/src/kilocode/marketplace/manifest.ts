import { createHash } from "node:crypto"
import { Effect, Schema } from "effect"
import { MarketplaceManifestError } from "./errors"
import { validateMcpMethod } from "./mcp"
import { Manifest, type Item, type Manifest as MarketplaceManifest } from "./schema"

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (!record(value)) return JSON.stringify(value)
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(",")}}`
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(stable(value)).digest("hex")}`
}

export function manifestFingerprint(manifest: MarketplaceManifest) {
  return fingerprint(manifest)
}

export function itemFingerprint(item: Item) {
  return fingerprint(item)
}

export const validateManifest = Effect.fn("Marketplace.validateManifest")(function* (manifest: MarketplaceManifest) {
  const items = new Set<string>()
  for (const item of manifest.items) {
    const key = `${item.kind}:${item.id}`
    if (items.has(key)) return yield* new MarketplaceManifestError({ reason: "duplicate_item", item: key })
    items.add(key)

    if (!item.installability.installable && !item.installability.reason) {
      return yield* new MarketplaceManifestError({ reason: "invalid_installability", item: key })
    }
    if (item.maturity === "unsupported" && item.installability.installable) {
      return yield* new MarketplaceManifestError({ reason: "invalid_installability", item: key })
    }
    if (item.kind === "skill") {
      if (item.installability.installable !== (item.artifact !== undefined)) {
        return yield* new MarketplaceManifestError({ reason: "invalid_installability", item: key })
      }
      continue
    }
    if (item.installability.installable && !item.methods.length) {
      return yield* new MarketplaceManifestError({ reason: "invalid_installability", item: key })
    }

    const methods = new Set<string>()
    for (const method of item.methods) {
      if (methods.has(method.id)) {
        return yield* new MarketplaceManifestError({ reason: "duplicate_method", item: `${key}:${method.id}` })
      }
      methods.add(method.id)
      yield* validateMcpMethod(item, method)
    }
  }
  return manifest
})

export const decodeManifest = Effect.fn("Marketplace.decodeManifest")(function* (input: unknown) {
  const manifest = yield* Schema.decodeUnknownEffect(Manifest)(input, { onExcessProperty: "error" }).pipe(
    Effect.mapError(() => new MarketplaceManifestError({ reason: "invalid_schema" })),
  )
  return yield* validateManifest(manifest)
})
