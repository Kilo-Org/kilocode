import path from "node:path"
import { createHash } from "node:crypto"
import { KILO_API_BASE } from "@kilocode/kilo-gateway"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Context, Effect, Layer, Schema, Scope, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import semver from "semver"
import { SkillArchive } from "./archive"
import {
  McpResolutionError,
  MarketplaceCacheError,
  MarketplaceEndpointError,
  MarketplaceManifestError,
  MarketplaceResourceError,
  MarketplaceUnavailableError,
  SkillArchiveError,
  SkillDownloadError,
  SkillInstallError,
  SkillIntegrityError,
} from "./errors"
import { decodeManifest, itemFingerprint, manifestFingerprint } from "./manifest"
import { LegacyMarketplace, type LegacyAsset } from "./legacy"
import { resolveMcp } from "./mcp"
import {
  type Artifact,
  CacheEntry,
  Digest as MarketplaceDigest,
  MAX_MANIFEST_BYTES,
  type Item,
  type Manifest,
  type Digest as MarketplaceDigestValue,
  type McpItem,
  type ParameterValue,
  type ResolvedMcp,
  SkillItem,
  type SkillItem as Skill,
} from "./schema"

export const DEFAULT_MARKETPLACE_ENDPOINT = "https://api.kilo.ai/api/marketplace"

export interface MarketplaceOptions {
  readonly endpoint?: string
  readonly cacheDir?: string
}

export interface ManifestResult {
  readonly manifest: Manifest
  readonly etag?: string
  readonly source: "network" | "cache-not-modified" | "cache-fallback"
}

export interface StagedSkill {
  readonly item: Skill
  readonly project: string
  readonly root: string
  readonly path: string
  readonly destination: string
}

export interface InstalledSkill {
  readonly id: string
  readonly version?: string
  readonly digest: string
  readonly path: string
  readonly skill: string
}

interface StageState {
  readonly id: string
  readonly version?: string
  readonly digest: string
  readonly project: string
  readonly root: string
  readonly path: string
  readonly destination: string
}

type ManifestError =
  | EffectFlock.LockError
  | MarketplaceEndpointError
  | MarketplaceUnavailableError
  | MarketplaceManifestError
  | MarketplaceCacheError

type StageError = SkillDownloadError | SkillIntegrityError | SkillArchiveError | SkillInstallError
type InstallError = StageError | EffectFlock.LockError

type Source =
  | { readonly mode: "manifest"; readonly cache: string; readonly url: string }
  | { readonly mode: "legacy"; readonly cache: string; readonly skills: string; readonly mcps: string }

function defaultEndpoint() {
  const base = process.env.KILO_API_BASE?.trim() || KILO_API_BASE || DEFAULT_MARKETPLACE_ENDPOINT
  const root = base.replace(/\/+$/, "")
  return root.endsWith("/api/marketplace") ? root : `${root}/api/marketplace`
}

function endpoint(value: string): Effect.Effect<string, MarketplaceEndpointError> {
  if (!URL.canParse(value)) return Effect.fail(new MarketplaceEndpointError({ reason: "invalid_url" }))
  const url = new URL(value)
  const loopback = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")
  if (url.protocol !== "https:" && !loopback) {
    return Effect.fail(new MarketplaceEndpointError({ reason: "insecure_url" }))
  }
  if (url.username || url.password || url.hash) {
    return Effect.fail(new MarketplaceEndpointError({ reason: "invalid_url" }))
  }
  return Effect.succeed(url.toString())
}

function child(root: string, name: string) {
  const url = new URL(root)
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${name}`
  url.search = ""
  return url.toString()
}

function source(value: string): Effect.Effect<Source, MarketplaceEndpointError> {
  return endpoint(value).pipe(
    Effect.map((input) => {
      const url = new URL(input)
      if (url.pathname.endsWith(".json")) return { mode: "manifest" as const, cache: input, url: input }
      if (url.pathname === "/") url.pathname = "/api/marketplace"
      url.pathname = url.pathname.replace(/\/(?:skills|mcps)\/?$/, "").replace(/\/+$/, "")
      url.search = ""
      const root = url.toString().replace(/\/+$/, "")
      return { mode: "legacy" as const, cache: root, skills: child(root, "skills"), mcps: child(root, "mcps") }
    }),
  )
}

function cacheName(endpoint: string) {
  return `manifest-${createHash("sha256").update(endpoint).digest("hex")}.json`
}

function safeEtag(value: string | undefined) {
  if (!value || value.length > 1_024 || /[\u0000-\u001f\u007f]/.test(value)) return undefined
  return value
}

function digest(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function githubArtifact(value: string) {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  const parts = url.pathname.split("/").filter(Boolean)
  return (
    url.protocol === "https:" && url.hostname === "github.com" && parts[2] === "releases" && parts[3] === "download"
  )
}

function redirect(from: string, location: string | undefined) {
  if (!location || !githubArtifact(from) || !URL.canParse(location, from)) return undefined
  const url = new URL(location, from)
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return undefined
  if (!["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"].includes(url.hostname)) {
    return undefined
  }
  return url.toString()
}

function revision(value: string) {
  const match = value.match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})\.([1-9][0-9]*)$/)
  if (!match) return undefined
  return { date: match[1], sequence: BigInt(match[2]) }
}

function older(next: string, previous: string) {
  const a = revision(next)
  const b = revision(previous)
  if (!a || !b) return false
  if (a.date !== b.date) return a.date < b.date
  return a.sequence < b.sequence
}

function itemKey(item: Item) {
  if (!item.version) return undefined
  return `${item.kind}:${item.id}@${item.version}`
}

function history(
  manifest: Manifest,
  previous: Readonly<Record<string, MarketplaceDigestValue>> = {},
): Record<string, MarketplaceDigestValue> {
  return Object.fromEntries([
    ...Object.entries(previous),
    ...manifest.items.flatMap((item) => {
      const key = itemKey(item)
      return key ? ([[key, MarketplaceDigest.make(itemFingerprint(item))]] as const) : []
    }),
  ])
}

function mutation(previous: Manifest, next: Manifest, fingerprints: Readonly<Record<string, string>>) {
  const items = new Map(previous.items.map((item) => [`${item.kind}:${item.id}`, item]))
  for (const item of next.items) {
    const key = `${item.kind}:${item.id}`
    const prior = items.get(key)
    if (prior && item.version && prior.version && semver.valid(item.version) && semver.valid(prior.version)) {
      if (semver.lt(item.version, prior.version)) return key
    }
    const versioned = itemKey(item)
    const fingerprint = versioned ? fingerprints[versioned] : undefined
    if (fingerprint && fingerprint !== itemFingerprint(item)) return key
  }
  return undefined
}

const body = <E>(
  stream: Stream.Stream<Uint8Array, unknown>,
  limit: number,
  overflow: () => E,
): Effect.Effect<Uint8Array, E | unknown> =>
  Stream.runFoldEffect(
    stream,
    () => ({ chunks: [] as Uint8Array[], size: 0 }),
    (state, chunk) => {
      const size = state.size + chunk.byteLength
      if (size > limit) return Effect.fail(overflow())
      state.chunks.push(chunk)
      return Effect.succeed({ chunks: state.chunks, size })
    },
  ).pipe(Effect.map((state) => Buffer.concat(state.chunks, state.size)))

export namespace Marketplace {
  export interface Interface {
    readonly manifest: () => Effect.Effect<ManifestResult, ManifestError>
    readonly find: (kind: "skill" | "mcp", id: string) => Effect.Effect<Item | undefined, ManifestError>
    readonly require: (
      kind: "skill" | "mcp",
      id: string,
    ) => Effect.Effect<Item, ManifestError | MarketplaceResourceError>
    readonly resolveMcp: (input: {
      readonly item: McpItem
      readonly method: string
      readonly parameters?: Readonly<Record<string, ParameterValue>>
    }) => Effect.Effect<ResolvedMcp, McpResolutionError>
    readonly stageSkillArchive: (input: {
      readonly project: string
      readonly item: Skill
      readonly bytes: Uint8Array
    }) => Effect.Effect<StagedSkill, SkillIntegrityError | SkillArchiveError | SkillInstallError, Scope.Scope>
    readonly stageSkill: (project: string, item: Skill) => Effect.Effect<StagedSkill, StageError, Scope.Scope>
    readonly commitSkill: (staged: StagedSkill) => Effect.Effect<InstalledSkill, SkillArchiveError | SkillInstallError>
    readonly installSkill: (project: string, item: Skill) => Effect.Effect<InstalledSkill, InstallError>
  }

  export class Service extends Context.Service<Service, Interface>()("@kilocode/Marketplace") {}

  export const layer = (options: MarketplaceOptions = {}) =>
    Layer.effect(
      Service,
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const http = yield* HttpClient.HttpClient
        const execute = (request: HttpClientRequest.HttpClientRequest) =>
          http.execute(request).pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }))
        const manual = (request: HttpClientRequest.HttpClientRequest) =>
          http.execute(request).pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }))
        const flock = yield* EffectFlock.Service
        const configured = options.endpoint ?? defaultEndpoint()
        const cacheDir = options.cacheDir ?? path.join(Global.Path.cache, "marketplace")
        const pending = new WeakMap<StagedSkill, StageState>()

        const readCache = Effect.fnUntraced(function* (url: string, file: string) {
          const raw = yield* fs.readFileStringSafe(file)
          if (raw === undefined) return undefined
          const json = yield* Effect.try({ try: () => JSON.parse(raw) as unknown, catch: () => undefined })
          if (json === undefined) return undefined
          const cached = yield* Schema.decodeUnknownEffect(CacheEntry)(json, { onExcessProperty: "error" }).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          )
          if (!cached || cached.endpoint !== url) return undefined
          const valid = yield* decodeManifest(cached.manifest).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!valid || manifestFingerprint(valid) !== cached.fingerprint) return undefined
          if (
            valid.items.some((item) => {
              const key = itemKey(item)
              const fingerprint = key ? cached.history?.[key] : undefined
              return fingerprint !== undefined && fingerprint !== itemFingerprint(item)
            })
          ) {
            return undefined
          }
          return { ...cached, history: history(valid, cached.history) }
        })

        const writeCache = Effect.fnUntraced(function* (
          file: string,
          value: {
            readonly endpoint: string
            readonly etag?: string
            readonly manifest: Manifest
            readonly history: Readonly<Record<string, MarketplaceDigestValue>>
          },
        ) {
          yield* fs
            .ensureDir(path.dirname(file))
            .pipe(Effect.mapError(() => new MarketplaceCacheError({ operation: "create" })))
          const temp = yield* fs
            .makeTempFile({ directory: path.dirname(file), prefix: ".manifest-" })
            .pipe(Effect.mapError(() => new MarketplaceCacheError({ operation: "create" })))
          const entry = {
            version: 1,
            endpoint: value.endpoint,
            ...(value.etag === undefined ? {} : { etag: value.etag }),
            manifest: value.manifest,
            fingerprint: manifestFingerprint(value.manifest),
            history: value.history,
          }
          yield* Effect.gen(function* () {
            yield* fs
              .writeFileString(temp, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
              .pipe(Effect.mapError(() => new MarketplaceCacheError({ operation: "write" })))
            yield* fs.rename(temp, file).pipe(Effect.mapError(() => new MarketplaceCacheError({ operation: "rename" })))
          }).pipe(Effect.ensuring(fs.remove(temp, { force: true }).pipe(Effect.ignore)))
        })

        const readBody = Effect.fnUntraced(function* (url: string, accept: string) {
          const response = yield* execute(
            HttpClientRequest.get(url).pipe(
              HttpClientRequest.setHeader("accept", accept),
              HttpClientRequest.setHeader("user-agent", "kilo-cli"),
            ),
          ).pipe(Effect.mapError(() => new MarketplaceUnavailableError({ reason: "network" })))
          if (response.status < 200 || response.status >= 300) {
            return yield* new MarketplaceUnavailableError({ reason: "http_status", status: response.status })
          }
          const length = Number(response.headers["content-length"])
          if (Number.isFinite(length) && length > MAX_MANIFEST_BYTES) {
            return yield* new MarketplaceManifestError({ reason: "body_too_large" })
          }
          return yield* body(
            response.stream,
            MAX_MANIFEST_BYTES,
            () => new MarketplaceManifestError({ reason: "body_too_large" }),
          ).pipe(
            Effect.mapError((error) =>
              error instanceof MarketplaceManifestError
                ? error
                : new MarketplaceUnavailableError({ reason: "network" }),
            ),
          )
        })

        const parseJson = Effect.fnUntraced(function* (bytes: Uint8Array) {
          return yield* Effect.try({
            try: () => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown,
            catch: () => new MarketplaceManifestError({ reason: "invalid_json" }),
          })
        })

        const verify = Effect.fnUntraced(function* (
          src: Source,
          manifest: Manifest,
          cached: CacheEntry | undefined,
          etag?: string,
        ) {
          const fingerprint = manifestFingerprint(manifest)
          if (cached && older(manifest.revision, cached.manifest.revision)) {
            return yield* new MarketplaceManifestError({ reason: "stale_revision" })
          }
          if (cached && cached.manifest.revision === manifest.revision && cached.fingerprint !== fingerprint) {
            return yield* new MarketplaceManifestError({ reason: "mutable_revision" })
          }
          const fingerprints = cached?.history ?? {}
          const changed = cached ? mutation(cached.manifest, manifest, fingerprints) : undefined
          if (changed) return yield* new MarketplaceManifestError({ reason: "mutable_item", item: changed })
          const file = path.join(cacheDir, cacheName(src.cache))
          yield* writeCache(file, { endpoint: src.cache, etag, manifest, history: history(manifest, fingerprints) })
          return { manifest, ...(etag === undefined ? {} : { etag }), source: "network" as const }
        })

        const direct = Effect.fnUntraced(function* (
          src: Extract<Source, { readonly mode: "manifest" }>,
          cached: CacheEntry | undefined,
        ) {
          const request = HttpClientRequest.get(src.url).pipe(
            HttpClientRequest.acceptJson,
            cached?.etag ? HttpClientRequest.setHeader("if-none-match", cached.etag) : (value) => value,
          )
          const response = yield* execute(request).pipe(
            Effect.mapError(() => new MarketplaceUnavailableError({ reason: "network" })),
          )
          if (response.status === 304) {
            if (!cached)
              return yield* new MarketplaceUnavailableError({ reason: "not_modified_without_cache", status: 304 })
            return { manifest: cached.manifest, etag: cached.etag, source: "cache-not-modified" as const }
          }
          if (response.status < 200 || response.status >= 300) {
            return yield* new MarketplaceUnavailableError({ reason: "http_status", status: response.status })
          }
          const length = Number(response.headers["content-length"])
          if (Number.isFinite(length) && length > MAX_MANIFEST_BYTES) {
            return yield* new MarketplaceManifestError({ reason: "body_too_large" })
          }
          const bytes = yield* body(
            response.stream,
            MAX_MANIFEST_BYTES,
            () => new MarketplaceManifestError({ reason: "body_too_large" }),
          ).pipe(
            Effect.mapError((error) =>
              error instanceof MarketplaceManifestError
                ? error
                : new MarketplaceUnavailableError({ reason: "network" }),
            ),
          )
          const manifest = yield* parseJson(bytes).pipe(Effect.flatMap(decodeManifest))
          const etag = safeEtag(response.headers.etag)
          return yield* verify(src, manifest, cached, etag)
        })

        const legacy = Effect.fnUntraced(function* (
          src: Extract<Source, { readonly mode: "legacy" }>,
          cached: CacheEntry | undefined,
        ) {
          const [skills, mcps] = yield* Effect.all(
            [
              readBody(src.skills, "application/x-yaml, text/yaml, text/plain, */*"),
              readBody(src.mcps, "application/x-yaml, text/yaml, text/plain, */*"),
            ],
            { concurrency: "unbounded" },
          )
          const releases = yield* LegacyMarketplace.releases(skills)
          const values = yield* Effect.forEach(
            releases,
            (url) =>
              readBody(url, "application/vnd.github+json, application/json").pipe(
                Effect.flatMap(parseJson),
                Effect.flatMap((json) =>
                  Effect.try({
                    try: () => LegacyMarketplace.assets(json),
                    catch: (error) =>
                      error instanceof MarketplaceManifestError
                        ? error
                        : new MarketplaceManifestError({ reason: "invalid_schema" }),
                  }),
                ),
              ),
            { concurrency: 4 },
          )
          const assets = new Map<string, LegacyAsset>()
          for (const asset of values.flat()) assets.set(asset.url, asset)
          const manifest = yield* LegacyMarketplace.decode({ skills, mcps, assets })
          return yield* verify(src, manifest, cached)
        })

        const load = Effect.fn("Marketplace.manifest")(function* () {
          const src = yield* source(configured)
          const file = path.join(cacheDir, cacheName(src.cache))
          return yield* flock.withLock(
            Effect.gen(function* () {
              const cached = yield* readCache(src.cache, file).pipe(Effect.catch(() => Effect.succeed(undefined)))
              const fresh = src.mode === "manifest" ? direct(src, cached) : legacy(src, cached)
              return yield* fresh.pipe(
                Effect.catch((error) =>
                  cached
                    ? Effect.succeed({
                        manifest: cached.manifest,
                        ...(cached.etag === undefined ? {} : { etag: cached.etag }),
                        source: "cache-fallback" as const,
                      })
                    : Effect.fail(error),
                ),
              )
            }),
            `marketplace-manifest:${src.cache}`,
            cacheDir,
          )
        })

        const find = Effect.fn("Marketplace.find")(function* (kind: "skill" | "mcp", id: string) {
          const result = yield* load()
          return result.manifest.items.find((item) => item.kind === kind && item.id === id)
        })

        const require = Effect.fn("Marketplace.require")(function* (kind: "skill" | "mcp", id: string) {
          const item = yield* find(kind, id)
          if (!item) return yield* new MarketplaceResourceError({ kind, id })
          return item
        })

        const artifact = Effect.fnUntraced(function* (id: string, expected: Artifact, bytes: Uint8Array) {
          if (bytes.byteLength !== expected.size) {
            return yield* new SkillIntegrityError({
              id,
              reason: "size",
              expected: String(expected.size),
              actual: String(bytes.byteLength),
            })
          }
          const actual = digest(bytes)
          if (actual !== expected.digest) {
            return yield* new SkillIntegrityError({
              id,
              reason: "digest",
              expected: expected.digest,
              actual,
            })
          }
          return bytes
        })

        const base = Effect.fnUntraced(function* (project: string, id: string) {
          const root = yield* fs
            .realPath(project)
            .pipe(Effect.mapError(() => new SkillInstallError({ id, reason: "invalid_project" })))
          if (!(yield* fs.isDir(root))) return yield* new SkillInstallError({ id, reason: "invalid_project" })

          const child = Effect.fnUntraced(function* (parent: string, name: string) {
            const dir = path.join(parent, name)
            if (!(yield* fs.existsSafe(dir))) {
              yield* fs
                .makeDirectory(dir, { mode: 0o700 })
                .pipe(Effect.mapError(() => new SkillInstallError({ id, reason: "filesystem" })))
            }
            const real = yield* fs
              .realPath(dir)
              .pipe(Effect.mapError(() => new SkillInstallError({ id, reason: "unsafe_destination" })))
            if (!AppFileSystem.contains(root, real) || !(yield* fs.isDir(real))) {
              return yield* new SkillInstallError({ id, reason: "unsafe_destination" })
            }
            return real
          })

          const kilo = yield* child(root, ".kilo")
          const skills = yield* child(kilo, "skills")
          return { project: root, skills }
        })

        const available = Effect.fnUntraced(function* (root: string, id: string) {
          const entries = yield* fs
            .readDirectoryEntries(root)
            .pipe(Effect.mapError(() => new SkillInstallError({ id, reason: "filesystem" })))
          if (entries.some((entry) => entry.name === id)) {
            return yield* new SkillInstallError({ id, reason: "already_installed" })
          }
        })

        const stageSkillArchive: Interface["stageSkillArchive"] = Effect.fn("Marketplace.stageSkillArchive")(
          function* (input) {
            const item = yield* Schema.decodeUnknownEffect(SkillItem)(input.item, { onExcessProperty: "error" }).pipe(
              Effect.mapError(() => new SkillInstallError({ id: input.item.id, reason: "invalid_item" })),
            )
            if (item.maturity === "unsupported" || !item.installability.installable || !item.artifact) {
              return yield* new SkillInstallError({ id: item.id, reason: "not_installable" })
            }
            yield* artifact(item.id, item.artifact, input.bytes)
            const target = yield* base(input.project, item.id)
            yield* available(target.skills, item.id)
            const stage = yield* Effect.acquireRelease(
              fs
                .makeTempDirectory({ directory: target.skills, prefix: `.staging-${item.id}-` })
                .pipe(Effect.mapError(() => new SkillInstallError({ id: item.id, reason: "filesystem" }))),
              (dir) => fs.remove(dir, { recursive: true, force: true }).pipe(Effect.ignore),
            )
            yield* SkillArchive.extract({ id: item.id, bytes: input.bytes, destination: stage }).pipe(
              Effect.provideService(AppFileSystem.Service, fs),
            )
            const staged = {
              item,
              project: target.project,
              root: target.skills,
              path: stage,
              destination: path.join(target.skills, item.id),
            }
            pending.set(staged, {
              id: item.id,
              version: item.version,
              digest: item.artifact.digest,
              project: staged.project,
              root: staged.root,
              path: staged.path,
              destination: staged.destination,
            })
            return staged
          },
        )

        const artifactResponse: (
          id: string,
          root: string,
          url: string,
          depth: number,
        ) => Effect.Effect<HttpClientResponse.HttpClientResponse, SkillDownloadError> = Effect.fnUntraced(function* (
          id: string,
          root: string,
          url: string,
          depth: number,
        ) {
          const response = yield* manual(HttpClientRequest.get(url)).pipe(
            Effect.mapError(() => new SkillDownloadError({ id, reason: "network" })),
          )
          if (response.status >= 300 && response.status < 400) {
            const next = redirect(root, response.headers.location)
            if (!next || depth >= 3) {
              return yield* new SkillDownloadError({ id, reason: "http_status", status: response.status })
            }
            return yield* artifactResponse(id, root, next, depth + 1)
          }
          return response
        })

        const download = Effect.fnUntraced(function* (item: Skill) {
          if (item.maturity === "unsupported" || !item.installability.installable || !item.artifact) {
            return yield* new SkillDownloadError({ id: item.id, reason: "not_installable" })
          }
          const response = yield* artifactResponse(item.id, item.artifact.url, item.artifact.url, 0)
          if (response.status < 200 || response.status >= 300) {
            return yield* new SkillDownloadError({ id: item.id, reason: "http_status", status: response.status })
          }
          const length = Number(response.headers["content-length"])
          if (Number.isFinite(length) && length > item.artifact.size) {
            return yield* new SkillDownloadError({ id: item.id, reason: "body_too_large" })
          }
          const bytes = yield* body(
            response.stream,
            item.artifact.size,
            () => new SkillDownloadError({ id: item.id, reason: "body_too_large" }),
          ).pipe(
            Effect.mapError((error) =>
              error instanceof SkillDownloadError ? error : new SkillDownloadError({ id: item.id, reason: "network" }),
            ),
          )
          return yield* artifact(item.id, item.artifact, bytes)
        })

        const stageSkill: Interface["stageSkill"] = Effect.fn("Marketplace.stageSkill")(function* (project, item) {
          const bytes = yield* download(item)
          return yield* stageSkillArchive({ project, item, bytes })
        })

        const commitSkill: Interface["commitSkill"] = Effect.fn("Marketplace.commitSkill")(function* (staged) {
          const state = pending.get(staged)
          if (!state) return yield* new SkillInstallError({ id: staged.item.id, reason: "invalid_stage" })
          const root = yield* fs
            .realPath(state.root)
            .pipe(Effect.mapError(() => new SkillInstallError({ id: state.id, reason: "unsafe_destination" })))
          const stage = yield* fs
            .realPath(state.path)
            .pipe(Effect.mapError(() => new SkillInstallError({ id: state.id, reason: "unsafe_destination" })))
          if (
            root !== state.root ||
            stage !== state.path ||
            !AppFileSystem.contains(state.project, root) ||
            !AppFileSystem.contains(root, stage) ||
            state.destination !== path.join(root, state.id)
          ) {
            return yield* new SkillInstallError({ id: state.id, reason: "unsafe_destination" })
          }
          yield* available(root, state.id)
          yield* SkillArchive.validate({ id: state.id, dir: stage }).pipe(
            Effect.provideService(AppFileSystem.Service, fs),
          )
          yield* fs
            .rename(stage, state.destination)
            .pipe(Effect.mapError(() => new SkillInstallError({ id: state.id, reason: "filesystem" })))
          pending.delete(staged)
          return {
            id: state.id,
            version: state.version,
            digest: state.digest,
            path: state.destination,
            skill: path.join(state.destination, "SKILL.md"),
          }
        })

        const installSkill: Interface["installSkill"] = Effect.fn("Marketplace.installSkill")(
          function* (project, item) {
            const root = yield* fs
              .realPath(project)
              .pipe(Effect.mapError(() => new SkillInstallError({ id: item.id, reason: "invalid_project" })))
            if (!(yield* fs.isDir(root)))
              return yield* new SkillInstallError({ id: item.id, reason: "invalid_project" })
            return yield* flock.withLock(
              Effect.scoped(
                Effect.gen(function* () {
                  const staged = yield* stageSkill(root, item)
                  return yield* commitSkill(staged)
                }),
              ),
              `marketplace-skill:${root}`,
            )
          },
        )

        return Service.of({
          manifest: load,
          find,
          require,
          resolveMcp,
          stageSkillArchive,
          stageSkill,
          commitSkill,
          installSkill,
        })
      }),
    )

  export const defaultLayer = layer().pipe(
    Layer.provide(EffectFlock.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
  )
}
