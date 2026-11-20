// Gates the public npm publish.
//
// The registry can expose a version before its tarball is readable from the CDN, and npm install resolves a version
// from the abbreviated install document rather than the single-version endpoint. A launcher published in that window
// installs, then postinstall resolves an optional platform dependency whose tarball returns 404; npm skips the
// unreachable optional dependency and the launcher keeps only its failure-stub binary. Read the install document,
// require the exact version, and probe one byte of its canonical same-origin tarball until both are served or the
// bounded attempts run out.
//
// The tarball probe never downloads a whole package. `Range` limits it to one byte, and the body stream is cancelled
// after the first chunk even when a registry ignores `Range`. Redirects are refused: the updater downloads the
// canonical npmjs tarball URL and would reject a target that only exists behind a registry redirect.
//
// A workflow rerun can run after a newer release has already moved the `kilo-v2` tag. `refuseStale` reads the version
// a tag currently points at and orders it numerically against the build version, so publish.ts fails the rerun before
// it can move the tag back.
//
// A manual rollback moves the tag back without unpublishing anything. `refuseWithdrawn` reads the launcher's published
// version history instead of the active tag, so a rerun of a run whose launcher was already published fails closed
// even when the tag points at an older version. A run whose launcher was never published is absent from that history,
// so a retry after a partial platform publish can continue.

import { isPreview, newer } from "../src/update-version"

export type Package = { name: string; version: string }

export type Options = {
  attempts?: number
  delay?: number
  registry?: string
  timeout?: number
}

type InstallDocument = {
  name?: unknown
  versions?: Record<string, { name?: unknown; version?: unknown; dist?: { tarball?: unknown } }>
}

const install = "application/vnd.npm.install-v1+json"

const defaults = {
  // Platform tarballs can lag behind npm's publish acknowledgment by several minutes.
  attempts: 60,
  delay: 10_000,
  timeout: 15_000,
  registry: "https://registry.npmjs.org",
}

export async function waitForRegistry(packages: Package[], options: Options = {}) {
  const attempts = options.attempts ?? defaults.attempts
  const delay = options.delay ?? defaults.delay
  const timeout = options.timeout ?? defaults.timeout
  const registry = base(options.registry ?? defaults.registry)
  // A package that is served once stays served for this gate. Only the remaining packages are probed again, so a
  // ready package does not spend the bounded attempts of a slow one.
  let pending: Array<{ pkg: Package; failure?: string }> = packages.map((pkg) => ({ pkg }))

  for (let attempt = 1; attempt <= attempts; attempt++) {
    pending = (
      await Promise.all(pending.map(async ({ pkg }) => ({ pkg, failure: await probe(pkg, registry, timeout) })))
    ).filter((entry): entry is { pkg: Package; failure: string } => entry.failure !== undefined)
    if (pending.length === 0) return
    if (attempt === attempts)
      throw new Error(
        `The public npm registry did not serve every package after ${attempts} ${attempts === 1 ? "attempt" : "attempts"}. Publishing the launcher now would install without a binary on some platforms: ${pending.map((entry) => entry.failure).join("; ")}`,
      )
    console.warn(
      `npm registry not ready (attempt ${attempt}/${attempts}): ${pending.map((entry) => entry.failure).join("; ")}`,
    )
    await Bun.sleep(delay)
  }
}

async function probe(pkg: Package, registry: string, timeout: number): Promise<string | undefined> {
  try {
    const metadata = await installDocument(pkg.name, registry, timeout)
    if (!metadata.ok) return `${pkg.name}@${pkg.version}: install document HTTP ${metadata.status}`
    const document = (await metadata.json()) as InstallDocument
    if (document.name !== pkg.name)
      return `${pkg.name}@${pkg.version}: install document is for ${String(document.name)}`
    const manifest = document.versions?.[pkg.version]
    if (!manifest) return `${pkg.name}@${pkg.version}: install document has no ${pkg.version}`
    if (manifest.name !== pkg.name || manifest.version !== pkg.version)
      return `${pkg.name}@${pkg.version}: install document entry is ${String(manifest.name)}@${String(manifest.version)}`
    if (typeof manifest.dist?.tarball !== "string") return `${pkg.name}@${pkg.version}: install document has no tarball`
    const canonical = tarball(registry, pkg)
    if (new URL(manifest.dist.tarball).href !== new URL(canonical).href)
      return `${pkg.name}@${pkg.version}: install document tarball ${manifest.dist.tarball} is not ${canonical}`
    const tarballResponse = await fetch(canonical, {
      headers: { range: "bytes=0-0" },
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    })
    if (!tarballResponse.ok) return `${pkg.name}@${pkg.version}: tarball HTTP ${tarballResponse.status}`
    const reader = tarballResponse.body?.getReader()
    if (!reader) return `${pkg.name}@${pkg.version}: tarball has no body`
    const chunk = await reader.read()
    await reader.cancel()
    if (!chunk.value || chunk.value.byteLength === 0) return `${pkg.name}@${pkg.version}: tarball is empty`
    return undefined
  } catch (error) {
    return `${pkg.name}@${pkg.version}: ${error instanceof Error ? error.message : String(error)}`
  }
}

// Reads the version a dist-tag points at. A missing tag is undefined, so the first publish can proceed.
export async function taggedVersion(pkg: string, tag: string, options: Options = {}) {
  const registry = base(options.registry ?? defaults.registry)
  const response = await fetch(`${registry}/${encodeURIComponent(pkg)}/${encodeURIComponent(tag)}`, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(options.timeout ?? defaults.timeout),
  })
  if (response.status === 404) return
  if (!response.ok) throw new Error(`${pkg}@${tag}: HTTP ${response.status}`)
  const manifest = (await response.json()) as { name?: unknown; version?: unknown }
  if (manifest.name !== pkg || typeof manifest.version !== "string")
    throw new Error(`${pkg}@${tag}: the registry returned ${String(manifest.name)}@${String(manifest.version)}`)
  return manifest.version
}

// A rerun of an older workflow run must not move a dist-tag back to its version. An equal version is allowed so the
// rerun can publish missing packages. A tag without the preview run and attempt format cannot be ordered safely.
export function stale(version: string, tagged: string) {
  return !isPreview(version) || !isPreview(tagged) || newer(tagged, version)
}

export async function refuseStale(pkg: string, version: string, tag: string, options: Options = {}) {
  const tagged = await taggedVersion(pkg, tag, options)
  if (tagged !== undefined && stale(version, tagged))
    throw new Error(`Refusing to publish ${pkg}@${version}: the ${tag} dist-tag already points to ${tagged}.`)
}

// Reads every preview version the registry already publishes. The launcher exists even before its first preview;
// an unavailable document cannot prove that the run was never published.
export async function previewVersions(pkg: string, options: Options = {}) {
  const registry = base(options.registry ?? defaults.registry)
  const response = await installDocument(pkg, registry, options.timeout ?? defaults.timeout)
  if (!response.ok) throw new Error(`${pkg}: install document HTTP ${response.status}`)
  const document = (await response.json()) as InstallDocument
  if (document.name !== pkg) throw new Error(`${pkg}: the registry returned ${String(document.name)}`)
  const versions = document.versions
  if (typeof versions !== "object" || versions === null || Array.isArray(versions))
    throw new Error(`${pkg}: the registry returned no version history`)
  return Object.keys(versions).filter(isPreview)
}

// Returns the published launcher version that covers `version`, if any. A launcher publishes once per run, so any
// attempt of a run at or below the published high-water mark was already promoted. Comparing the numeric run rather
// than only the full version rejects a later attempt of the withdrawn run. `newer` picks the high-water because it
// orders both the run and the attempt numerically. A rollback is assumed to move only the tag: this reads versions
// that are still published, so a version removed from the registry no longer blocks a rerun.
export function withdrawn(version: string, published: string[]) {
  const run = previewRun(version)
  if (run === undefined) return version
  const highest = highestPreview(published)
  if (highest === undefined) return
  const high = previewRun(highest)
  if (high === undefined) return version
  if (run > high) return
  return highest
}

function highestPreview(published: string[]) {
  const previews = published.filter(isPreview)
  return previews.reduce<string | undefined>(
    (highest, candidate) => (highest === undefined || newer(candidate, highest) ? candidate : highest),
    undefined,
  )
}

export async function refuseWithdrawn(pkg: string, version: string, options: Options = {}) {
  if (!isPreview(version)) throw new Error(`Refusing to publish ${pkg}@${version}: it is not a Kilo v2 preview.`)
  const blocked = withdrawn(version, await previewVersions(pkg, options))
  if (blocked === undefined) return
  throw new Error(
    `Refusing to publish ${pkg}@${version}: the launcher already published ${pkg}@${blocked}. A manual rollback does not make a rerun of run ${previewRun(version)} safe.`,
  )
}

// `isPreview` has already validated the `0.0.0-v2-<run>[.<attempt>]` shape.
function previewRun(version: string) {
  if (!isPreview(version)) return
  return Number(version.slice("0.0.0-v2-".length).split(".")[0])
}

function installDocument(name: string, registry: string, timeout: number) {
  return fetch(`${registry}/${encodeURIComponent(name)}`, {
    headers: { accept: install, "cache-control": "no-cache" },
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  })
}

function base(registry: string) {
  return registry.replace(/\/+$/, "")
}

function tarball(registry: string, pkg: Package) {
  return `${registry}/${pkg.name}/-/${pkg.name.slice(pkg.name.lastIndexOf("/") + 1)}-${pkg.version}.tgz`
}
