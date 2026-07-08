import path from "node:path"
import { createHash } from "node:crypto"
import { KILO_API_BASE } from "@kilocode/kilo-gateway"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Stack } from "../schema"
import { builtin } from "./index"
import { revision as snapshotRevision } from "./data"

const MAX_CATALOG_BYTES = 5 * 1024 * 1024
const CATALOG_PATH = "stack.json"

export interface CatalogResult {
  readonly catalog: Stack.Catalog
  readonly origin: Stack.CatalogOrigin
}

const snapshot: CatalogResult = { catalog: builtin, origin: "fallback" }

function deriveEndpoint() {
  const base = process.env.KILO_API_BASE?.trim() || KILO_API_BASE || "https://api.kilo.ai/api/marketplace"
  return `${base.replace(/\/+$/, "")}/${CATALOG_PATH}`
}

function cacheName(url: string) {
  return `stack-catalog-${createHash("sha256").update(url).digest("hex")}.json`
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  return `{${Object.keys(value as object)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
    .join(",")}}`
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(stable(value)).digest("hex")}`
}

function parseRevision(value: string) {
  const m = value.match(/^(\d{4}-\d{2}-\d{2})\.(\d+)$/)
  if (!m) return undefined
  return { date: m[1], seq: BigInt(m[2]) }
}

/** Returns true when `candidate` is at least as new as `reference`. */
function atLeastAsNew(candidate: string, reference: string) {
  const a = parseRevision(candidate)
  const b = parseRevision(reference)
  if (!a || !b) return true
  if (a.date !== b.date) return a.date > b.date
  return a.seq >= b.seq
}

function readBytes(stream: Stream.Stream<Uint8Array, unknown>, limit: number): Effect.Effect<Uint8Array | undefined> {
  return Stream.runFoldEffect(
    stream,
    () => ({ chunks: [] as Uint8Array[], size: 0 }),
    (state, chunk) => {
      const size = state.size + chunk.byteLength
      if (size > limit) return Effect.succeed({ ...state, size: Infinity })
      state.chunks.push(chunk)
      return Effect.succeed({ chunks: state.chunks, size })
    },
  ).pipe(
    Effect.map((state) =>
      state.size === Infinity ? undefined : Buffer.concat(state.chunks, state.size),
    ),
    Effect.catch(() => Effect.succeed(undefined)),
  )
}

interface CacheEntry {
  readonly endpoint: string
  readonly etag?: string
  readonly catalog: unknown
  readonly fingerprint: string
}

export interface CatalogSourceOptions {
  readonly endpoint?: string
  readonly cacheDir?: string
}

export namespace CatalogSource {
  export interface Interface {
    /** Always resolves — either the served catalog or the bundled fallback snapshot. */
    readonly get: () => Effect.Effect<CatalogResult>
  }

  export class Service extends Context.Service<Service, Interface>()("@kilocode/CatalogSource") {}

  export const layer = (options: CatalogSourceOptions = {}) =>
    Layer.effect(
      Service,
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const http = yield* HttpClient.HttpClient
        const flock = yield* EffectFlock.Service
        const url = options.endpoint ?? deriveEndpoint()
        const dir = options.cacheDir ?? path.join(Global.Path.cache, "marketplace")
        const file = path.join(dir, cacheName(url))

        const readCache = Effect.fnUntraced(function* () {
          const raw = yield* fs.readFileStringSafe(file)
          if (!raw) return undefined
          const json = yield* Effect.try({ try: () => JSON.parse(raw) as unknown, catch: () => undefined })
          if (!json || typeof json !== "object" || Array.isArray(json)) return undefined
          const entry = json as CacheEntry
          if (entry.endpoint !== url) return undefined
          const catalog = yield* Effect.try({
            try: () => Schema.decodeUnknownSync(Stack.Catalog)(entry.catalog, { onExcessProperty: "ignore" }),
            catch: () => undefined,
          })
          if (!catalog) return undefined
          if (fingerprint(catalog) !== entry.fingerprint) return undefined
          return { catalog, etag: entry.etag }
        })

        const writeCache = Effect.fnUntraced(function* (catalog: Stack.Catalog, etag?: string) {
          const entry = {
            endpoint: url,
            ...(etag ? { etag } : {}),
            catalog,
            fingerprint: fingerprint(catalog),
          }
          yield* fs.ensureDir(dir).pipe(Effect.ignore)
          const temp = yield* fs
            .makeTempFile({ directory: dir, prefix: ".stack-catalog-" })
            .pipe(Effect.catch(() => Effect.succeed("")))
          if (!temp) return
          yield* Effect.gen(function* () {
            yield* fs.writeFileString(temp, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
            yield* fs.rename(temp, file)
          }).pipe(
            Effect.ensuring(fs.remove(temp, { force: true }).pipe(Effect.ignore)),
            Effect.ignore,
          )
        })

        const fetch = Effect.fnUntraced(function* (etag?: string) {
          const req = HttpClientRequest.get(url).pipe(
            HttpClientRequest.acceptJson,
            etag ? HttpClientRequest.setHeader("if-none-match", etag) : (r) => r,
          )
          return yield* http.execute(req).pipe(Effect.catch(() => Effect.succeed(undefined)))
        })

        const load = Effect.fnUntraced(function* () {
          return yield* flock.withLock(
            Effect.gen(function* () {
              const cached = yield* readCache().pipe(Effect.catch(() => Effect.succeed(undefined)))
              const res = yield* fetch(cached?.etag)
              if (!res) return cached?.catalog

              if (res.status === 304 && cached) return cached.catalog
              if (res.status < 200 || res.status >= 300) return cached?.catalog

              const bytes = yield* readBytes(res.stream, MAX_CATALOG_BYTES)
              if (!bytes) return cached?.catalog

              const raw = yield* Effect.try({ try: () => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown, catch: () => undefined })
              if (!raw) return cached?.catalog

              const catalog = yield* Effect.try({
                try: () => Schema.decodeUnknownSync(Stack.Catalog)(raw, { onExcessProperty: "ignore" }),
                catch: () => undefined,
              })
              if (!catalog) return cached?.catalog

              const etag = typeof res.headers.etag === "string" ? res.headers.etag : undefined
              yield* writeCache(catalog, etag)
              return catalog
            }),
            `stack-catalog:${url}`,
            dir,
          ).pipe(Effect.catch(() => Effect.succeed(undefined)))
        })

        const get = Effect.fn("CatalogSource.get")(function* () {
          const catalog = yield* load().pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!catalog || !atLeastAsNew(catalog.revision, snapshotRevision)) return snapshot
          return { catalog, origin: "served" as const }
        })

        return Service.of({ get })
      }),
    )

  export const defaultLayer = layer().pipe(
    Layer.provide(EffectFlock.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
  )

  /** Always returns the bundled snapshot. Useful in tests and offline environments. */
  export const snapshotLayer = Layer.succeed(
    Service,
    Service.of({ get: () => Effect.succeed(snapshot) }),
  )
}
