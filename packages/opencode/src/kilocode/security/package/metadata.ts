import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"

/**
 * Registry metadata for the package preflight, behind a small provider interface so tests and the
 * benchmark run against deterministic fixtures and never depend on the live registry.
 *
 * - {@link PackageMetadata.fixture}: in-memory, deterministic (relative ages against an injected clock);
 * - {@link PackageMetadata.unavailable}: every lookup fails (models an offline / blocked registry);
 * - {@link PackageMetadata.live}: the public npm registry + downloads API, cached, bounded by a timeout
 *   and a response-size cap. Optional; a failure is reported as `unavailable`, never as "fine".
 *
 * Nothing here decides anything: the evaluator turns metadata into signals and the engine into a
 * decision. Lookup failures are a first-class outcome (`MetadataUnavailable`), not a silent default.
 */
export namespace PackageMetadata {
  const log = Log.create({ service: "security.package" })

  /** npm lifecycle hooks that run code during installation. */
  export const LIFECYCLE = ["preinstall", "install", "postinstall", "prepare"] as const

  export interface VersionInfo {
    publishedAt?: string
    /** Lifecycle hooks declared by this version (subset of {@link LIFECYCLE}). */
    scripts: string[]
    deprecated?: boolean
  }

  export interface Metadata {
    name: string
    found: boolean
    createdAt?: string
    modifiedAt?: string
    distTags: Record<string, string>
    versions: Record<string, VersionInfo>
    /** Downloads over the last 7 days; undefined when the provider cannot say. */
    weeklyDownloads?: number
    maintainers?: number
    repository?: string
    /** Provider that answered (fixture / npm / ...). */
    provider: string
  }

  export class MetadataUnavailable extends Error {
    readonly _tag = "MetadataUnavailable"
    constructor(
      readonly pkg: string,
      readonly reason: string,
    ) {
      super(`registry metadata unavailable for ${pkg}: ${reason}`)
      this.name = "MetadataUnavailable"
    }
  }

  export interface Provider {
    readonly id: string
    lookup(name: string): Effect.Effect<Metadata, MetadataUnavailable>
  }

  // -------------------------------------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------------------------------------

  export interface FixtureVersion {
    version: string
    /** Days before `now` the version was published. */
    daysAgo: number
    scripts?: string[]
    deprecated?: boolean
  }

  export interface FixtureEntry {
    name: string
    /** Days before `now` the package was created. */
    createdDaysAgo: number
    versions: FixtureVersion[]
    latest?: string
    weeklyDownloads?: number
    maintainers?: number
    repository?: string
    /** When true the lookup fails with `MetadataUnavailable` (models a flaky / blocked registry). */
    unavailable?: boolean
  }

  function isoDaysAgo(now: Date, days: number) {
    return new Date(now.getTime() - days * 86_400_000).toISOString()
  }

  /** Deterministic in-memory provider. Unknown names resolve to `found: false`. */
  export function fixture(entries: FixtureEntry[], opts: { now?: () => Date; id?: string } = {}): Provider {
    const now = opts.now ?? (() => new Date())
    const table = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]))
    const id = opts.id ?? "fixture"
    return {
      id,
      lookup: (name) =>
        Effect.suspend(() => {
          const entry = table.get(name.toLowerCase())
          if (!entry) {
            return Effect.succeed<Metadata>({ name, found: false, distTags: {}, versions: {}, provider: id })
          }
          if (entry.unavailable) return Effect.fail(new MetadataUnavailable(name, "fixture marked unavailable"))
          const clock = now()
          const versions: Record<string, VersionInfo> = {}
          for (const version of entry.versions) {
            versions[version.version] = {
              publishedAt: isoDaysAgo(clock, version.daysAgo),
              scripts: version.scripts ?? [],
              deprecated: version.deprecated,
            }
          }
          const latest = entry.latest ?? entry.versions.at(-1)?.version
          return Effect.succeed<Metadata>({
            name: entry.name,
            found: true,
            createdAt: isoDaysAgo(clock, entry.createdDaysAgo),
            modifiedAt: isoDaysAgo(clock, Math.min(...entry.versions.map((version) => version.daysAgo))),
            distTags: latest ? { latest } : {},
            versions,
            weeklyDownloads: entry.weeklyDownloads,
            maintainers: entry.maintainers,
            repository: entry.repository,
            provider: id,
          })
        }),
    }
  }

  /** A provider that can never answer. Used to prove that lookup failure fails safe. */
  export function unavailable(reason = "registry unreachable"): Provider {
    return { id: "unavailable", lookup: (name) => Effect.fail(new MetadataUnavailable(name, reason)) }
  }

  // -------------------------------------------------------------------------------------------
  // Live npm registry (optional adapter)
  // -------------------------------------------------------------------------------------------

  export interface LiveOptions {
    registry?: string
    downloads?: string
    timeoutMs?: number
    /** Reject registry documents larger than this (bytes); very large documents are treated as unavailable. */
    maxBytes?: number
    cacheTtlMs?: number
    fetch?: typeof fetch
  }

  interface RegistryDocument {
    name?: string
    time?: Record<string, string>
    "dist-tags"?: Record<string, string>
    versions?: Record<string, { scripts?: Record<string, string>; deprecated?: string | boolean }>
    maintainers?: unknown[]
    repository?: { url?: string } | string
  }

  function repositoryOf(value: RegistryDocument["repository"]) {
    if (typeof value === "string") return value
    if (value && typeof value.url === "string") return value.url
    return undefined
  }

  export function live(opts: LiveOptions = {}): Provider {
    const registry = (opts.registry ?? "https://registry.npmjs.org").replace(/\/$/, "")
    const downloads = (opts.downloads ?? "https://api.npmjs.org/downloads/point/last-week").replace(/\/$/, "")
    const timeoutMs = opts.timeoutMs ?? 5_000
    const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024
    const ttl = opts.cacheTtlMs ?? 60 * 60_000
    const doFetch = opts.fetch ?? fetch
    const cache = new Map<string, { at: number; value: Metadata }>()

    async function getJson(url: string): Promise<{ status: number; body: unknown }> {
      const response = await doFetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json" },
      })
      const length = Number(response.headers.get("content-length") ?? "0")
      if (length > maxBytes) throw new Error(`document too large (${length} bytes)`)
      const text = await response.text()
      if (text.length > maxBytes) throw new Error(`document too large (${text.length} bytes)`)
      return { status: response.status, body: response.status === 404 ? undefined : JSON.parse(text) }
    }

    async function lookup(name: string): Promise<Metadata> {
      const cached = cache.get(name)
      if (cached && Date.now() - cached.at < ttl) return cached.value
      const encoded = name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name)
      const doc = await getJson(`${registry}/${encoded}`)
      if (doc.status === 404) {
        const missing: Metadata = { name, found: false, distTags: {}, versions: {}, provider: "npm" }
        cache.set(name, { at: Date.now(), value: missing })
        return missing
      }
      if (doc.status !== 200) throw new Error(`registry responded ${doc.status}`)
      const body = doc.body as RegistryDocument
      const versions: Record<string, VersionInfo> = {}
      for (const [version, info] of Object.entries(body.versions ?? {})) {
        versions[version] = {
          publishedAt: body.time?.[version],
          scripts: LIFECYCLE.filter((hook) => typeof info.scripts?.[hook] === "string"),
          deprecated: info.deprecated !== undefined && info.deprecated !== false,
        }
      }
      let weeklyDownloads: number | undefined
      try {
        const stats = await getJson(`${downloads}/${encoded}`)
        const count = (stats.body as { downloads?: unknown } | undefined)?.downloads
        if (typeof count === "number") weeklyDownloads = count
      } catch (err) {
        log.info("downloads lookup failed", { error: err instanceof Error ? err.name : "Error" })
      }
      const value: Metadata = {
        name: body.name ?? name,
        found: true,
        createdAt: body.time?.created,
        modifiedAt: body.time?.modified,
        distTags: body["dist-tags"] ?? {},
        versions,
        weeklyDownloads,
        maintainers: Array.isArray(body.maintainers) ? body.maintainers.length : undefined,
        repository: repositoryOf(body.repository),
        provider: "npm",
      }
      cache.set(name, { at: Date.now(), value })
      return value
    }

    return {
      id: "npm",
      lookup: (name) =>
        Effect.tryPromise({
          try: () => lookup(name),
          catch: (err) => new MetadataUnavailable(name, err instanceof Error ? err.name : "Error"),
        }),
    }
  }

  // -------------------------------------------------------------------------------------------
  // Active provider
  // -------------------------------------------------------------------------------------------

  let active: Provider | undefined

  /** The provider the gate consults. Defaults to the live npm adapter. */
  export function provider(): Provider {
    active ??= live()
    return active
  }

  /** Install a provider (fixtures in tests / the benchmark); returns a disposer restoring the previous one. */
  export function use(next: Provider): () => void {
    const previous = active
    active = next
    return () => {
      if (active === next) active = previous
    }
  }

  // -------------------------------------------------------------------------------------------
  // Version resolution (minimal semver: exact, tags, x-ranges, ^ and ~, simple comparators)
  // -------------------------------------------------------------------------------------------

  type Parsed = { major: number; minor: number; patch: number; pre: boolean; raw: string }

  function parse(version: string): Parsed | undefined {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/)
    if (!match) return undefined
    return {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
      pre: match[4] !== undefined,
      raw: version.trim(),
    }
  }

  function compare(a: Parsed, b: Parsed) {
    if (a.major !== b.major) return a.major - b.major
    if (a.minor !== b.minor) return a.minor - b.minor
    if (a.patch !== b.patch) return a.patch - b.patch
    if (a.pre !== b.pre) return a.pre ? -1 : 1
    return 0
  }

  function satisfies(version: Parsed, range: string): boolean | undefined {
    const text = range.trim()
    // Ranges never select pre-releases unless the range names one explicitly (semver semantics).
    if (text === "" || text === "*" || text === "x" || text === "latest") return !version.pre
    const exact = parse(text)
    if (exact) return compare(version, exact) === 0
    const partial = text.match(/^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(x|\*))?$/)
    if (partial) {
      const major = Number(partial[1])
      const minor =
        partial[2] === undefined || partial[2] === "x" || partial[2] === "*" ? undefined : Number(partial[2])
      return version.major === major && (minor === undefined || version.minor === minor) && !version.pre
    }
    const caret = text.match(/^\^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
    if (caret) {
      const major = Number(caret[1])
      const minor = caret[2] === undefined ? 0 : Number(caret[2])
      const patch = caret[3] === undefined ? 0 : Number(caret[3])
      const lower: Parsed = { major, minor, patch, pre: false, raw: "" }
      if (compare(version, lower) < 0 || version.pre) return false
      if (major > 0) return version.major === major
      if (minor > 0) return version.major === 0 && version.minor === minor
      return version.major === 0 && version.minor === 0 && version.patch === patch
    }
    const tilde = text.match(/^~v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
    if (tilde) {
      const major = Number(tilde[1])
      const minor = tilde[2] === undefined ? undefined : Number(tilde[2])
      const patch = tilde[3] === undefined ? 0 : Number(tilde[3])
      if (version.pre) return false
      if (minor === undefined) return version.major === major
      const lower: Parsed = { major, minor, patch, pre: false, raw: "" }
      return version.major === major && version.minor === minor && compare(version, lower) >= 0
    }
    const comparators = text.split(/\s+/).map((part) => part.match(/^(>=|<=|>|<|=)?v?(\d+\.\d+\.\d+)$/))
    if (comparators.length > 0 && comparators.every((part) => part !== null)) {
      if (version.pre) return false
      return comparators.every((part) => {
        const bound = parse(part![2]!)!
        const cmp = compare(version, bound)
        switch (part![1] ?? "=") {
          case ">=":
            return cmp >= 0
          case "<=":
            return cmp <= 0
          case ">":
            return cmp > 0
          case "<":
            return cmp < 0
          default:
            return cmp === 0
        }
      })
    }
    return undefined
  }

  /**
   * Which published version a request resolves to: exact versions and dist-tags map directly; ranges
   * pick the highest satisfying release. `resolved: false` means the range syntax is not understood
   * (the caller treats it as uncertainty and falls back to `latest`).
   */
  export function resolve(meta: Metadata, requested: string | undefined): { version?: string; resolved: boolean } {
    const tags = meta.distTags
    const want = requested === undefined || requested === "" ? "latest" : requested
    if (tags[want] !== undefined) return { version: tags[want], resolved: true }
    if (meta.versions[want] !== undefined) return { version: want, resolved: true }
    const candidates = Object.keys(meta.versions)
      .map(parse)
      .filter((item): item is Parsed => item !== undefined)
      .sort(compare)
    let understood = true
    const matching = candidates.filter((item) => {
      const ok = satisfies(item, want)
      if (ok === undefined) understood = false
      return ok === true
    })
    if (!understood) return { version: tags["latest"], resolved: false }
    const best = matching.at(-1)
    return { version: best?.raw, resolved: true }
  }
}
