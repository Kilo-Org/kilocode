/**
 * CycloneDX 1.6 document model and composer.
 *
 * Kilo publishes one SBOM per shipped artifact (CLI archive, npm tarball, OCI
 * manifest, VSIX, JetBrains plugin ZIP). Every document is composed here so the
 * shape, property namespace, and determinism rules stay identical across
 * products instead of drifting per build script.
 */

import { createHash } from "node:crypto"

export const SPEC_VERSION = "1.6"
export const PROPERTY_NAMESPACE = "kilocode"

/**
 * How a component reaches the user.
 *
 * - `contained` is physically inside the artifact bytes.
 * - `provided` is supplied by the host (IDE platform modules, JNA, coroutines)
 *   and must not be claimed as part of the artifact.
 * - `runtime` is downloaded or installed later by Kilo against a pinned
 *   version (JetBrains lean CLI assets, optional LanceDB, ripgrep).
 */
export type Delivery = "contained" | "provided" | "runtime"

export type Hash = { alg: "SHA-256" | "SHA-512" | "SHA-1"; content: string }

export type Component = {
  type: "application" | "library" | "framework" | "file" | "container" | "operating-system" | "data"
  name: string
  version?: string
  purl?: string
  ref?: string
  group?: string
  description?: string
  supplier?: string
  author?: string
  licenses?: string[]
  hashes?: Hash[]
  delivery?: Delivery
  platform?: string
  properties?: Record<string, string>
}

export type Subject = {
  /** Release asset filename as published, e.g. `kilo-linux-x64.tar.gz`. */
  name: string
  sha256: string
  size?: number
}

export type Product = {
  name: string
  version: string
  type?: Component["type"]
  purl?: string
  description?: string
  licenses?: string[]
}

export type Build = {
  /** Commit the artifact was actually built from, never a later release tag. */
  commit?: string
  channel?: string
  workflow?: string
  run?: string
  /** Extra provenance, e.g. JetBrains tag SHA and reviewed merge SHA. */
  properties?: Record<string, string>
}

export type Target = {
  platform?: string
  os?: string
  arch?: string
  abi?: string
  baseline?: boolean
}

export type Tool = { name: string; version?: string }

export type Gap = { component: string; reason: string }

export type Compose = {
  subject: Subject
  product: Product
  target?: Target
  build?: Build
  tools?: Tool[]
  components?: Component[]
  /** `ref` -> refs it depends on. Refs missing from components are dropped. */
  dependencies?: Record<string, string[]>
  /** Coverage limitations recorded instead of being silently omitted. */
  gaps?: Gap[]
}

export type Bom = {
  bomFormat: "CycloneDX"
  specVersion: string
  serialNumber: string
  version: number
  metadata: Record<string, unknown>
  components: Record<string, unknown>[]
  dependencies: { ref: string; dependsOn: string[] }[]
}

const SUPPLIER = { name: "Kilo Code", url: ["https://kilo.ai"] }

/**
 * Deterministic serial number.
 *
 * Two runs that produce byte-identical artifacts must produce the same
 * serialNumber, otherwise consumers cannot tell a rebuild from a new document.
 * Derived from the subject digest rather than random per-run bytes.
 */
export function serial(sha256: string) {
  const hex = createHash("sha256").update(`${PROPERTY_NAMESPACE}:sbom:${sha256}`).digest("hex").slice(0, 32)
  const bytes = Buffer.from(hex, "hex")
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const value = bytes.toString("hex")
  const parts = [value.slice(0, 8), value.slice(8, 12), value.slice(12, 16), value.slice(16, 20), value.slice(20, 32)]
  return `urn:uuid:${parts.join("-")}`
}

/**
 * Generation timestamp. CycloneDX requires one, so honour SOURCE_DATE_EPOCH to
 * keep reproducible builds reproducible instead of dropping the field.
 */
export function timestamp(env: Record<string, string | undefined> = process.env) {
  const epoch = env.SOURCE_DATE_EPOCH
  if (!epoch) return new Date().toISOString()
  const seconds = Number(epoch)
  if (!Number.isFinite(seconds)) throw new Error(`Invalid SOURCE_DATE_EPOCH: ${epoch}`)
  return new Date(seconds * 1000).toISOString()
}

function property(name: string, value: string) {
  return { name: `${PROPERTY_NAMESPACE}:${name}`, value }
}

function properties(entries: Record<string, string | undefined>) {
  return Object.entries(entries)
    .flatMap(([name, value]) => (value == null || value === "" ? [] : [property(name, value)]))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function licenses(values?: string[]) {
  if (!values?.length) return undefined
  return values.map((value) =>
    /[\s()]|(?: OR )|(?: AND )|(?: WITH )/.test(value) ? { expression: value } : { license: { id: value } },
  )
}

const SCOPE: Record<Delivery, "required" | "optional" | "excluded"> = {
  contained: "required",
  provided: "excluded",
  runtime: "optional",
}

/**
 * Stable identity for a component. purl is preferred because it is what
 * consumers correlate against advisory databases.
 *
 * Delivery is deliberately not part of the identity. Dependency edges are built
 * from the same purls and refs, so encoding delivery here would make any
 * reclassified component unreachable from its edges and silently flatten the
 * graph. Delivery is expressed through `scope` and the delivery property.
 */
export function ref(input: Component) {
  if (input.ref) return input.ref
  if (input.purl) return input.purl
  const scope = [input.group, input.name].filter(Boolean).join("/")
  const platform = input.platform ? `?platform=${input.platform}` : ""
  return `${input.type}:${scope}@${input.version ?? "unknown"}${platform}`
}

/**
 * When inputs disagree on how one component is delivered, the strongest claim
 * wins. A component that is physically present is contained even if another
 * input also installs it on demand, because that copy is what users receive
 * and what vulnerability handling has to account for.
 */
const STRENGTH: Record<Delivery, number> = { contained: 2, runtime: 1, provided: 0 }

function strongest(a?: Delivery, b?: Delivery): Delivery {
  const x = a ?? "contained"
  const y = b ?? "contained"
  return STRENGTH[x] >= STRENGTH[y] ? x : y
}

/**
 * Merge components from several generators into one list.
 *
 * Kilo composes each SBOM from a bundler graph, a physical artifact scan, and
 * explicitly modelled native components, so the same package routinely arrives
 * more than once. Identity is the purl (or explicit ref); conflicting delivery
 * claims resolve to the strongest one rather than producing two components that
 * collide on one `bom-ref`.
 */
export function dedupe(input: Component[]) {
  const merged = new Map<string, Component>()
  for (const item of input) {
    const key = ref(item)
    const previous = merged.get(key)
    if (!previous) {
      merged.set(key, item)
      continue
    }
    merged.set(key, {
      ...previous,
      ...item,
      delivery: strongest(previous.delivery, item.delivery),
      licenses: union(previous.licenses, item.licenses),
      hashes: hashes(previous.hashes, item.hashes),
      properties: { ...previous.properties, ...item.properties },
    })
  }
  return [...merged.values()].sort((a, b) => ref(a).localeCompare(ref(b)))
}

function union(a?: string[], b?: string[]) {
  const values = [...(a ?? []), ...(b ?? [])]
  return values.length ? [...new Set(values)].sort() : undefined
}

function hashes(a?: Hash[], b?: Hash[]) {
  const values = [...(a ?? []), ...(b ?? [])]
  if (!values.length) return undefined
  const merged = new Map(values.map((item) => [`${item.alg}:${item.content}`, item]))
  return [...merged.values()].sort((x, y) => `${x.alg}${x.content}`.localeCompare(`${y.alg}${y.content}`))
}

function component(input: Component) {
  const delivery = input.delivery ?? "contained"
  return {
    "bom-ref": ref(input),
    type: input.type,
    name: input.name,
    ...(input.group ? { group: input.group } : {}),
    ...(input.version ? { version: input.version } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.supplier ? { supplier: { name: input.supplier } } : {}),
    ...(input.author ? { author: input.author } : {}),
    ...(input.purl ? { purl: input.purl } : {}),
    scope: SCOPE[delivery],
    ...(licenses(input.licenses) ? { licenses: licenses(input.licenses) } : {}),
    ...(input.hashes?.length ? { hashes: input.hashes } : {}),
    properties: properties({
      delivery,
      ...(input.platform ? { platform: input.platform } : {}),
      ...input.properties,
    }),
  }
}

export function compose(input: Compose): Bom {
  const components = dedupe(input.components ?? [])
  const refs = new Set(components.map((item) => ref(item)))
  const root = `${PROPERTY_NAMESPACE}:artifact:${input.subject.name}`

  // Only keep edges whose endpoints exist, so `dependencies` never points at a
  // component that was filtered out as dev-only or host-provided.
  const edges = Object.entries(input.dependencies ?? {}).flatMap(([from, to]) => {
    if (from !== root && !refs.has(from)) return []
    const resolved = [...new Set(to)].filter((item) => refs.has(item)).sort()
    return [{ ref: from, dependsOn: resolved }]
  })
  const declared = new Set(edges.map((item) => item.ref))

  // Anything with no recorded parent hangs off the artifact root, otherwise the
  // graph would claim the component is unreachable.
  const child = new Set(edges.flatMap((item) => item.dependsOn))
  const top = components.map((item) => ref(item)).filter((item) => !child.has(item))
  const rootEdge = edges.find((item) => item.ref === root)
  const dependencies = [
    { ref: root, dependsOn: [...new Set([...(rootEdge?.dependsOn ?? []), ...top])].sort() },
    ...edges.filter((item) => item.ref !== root),
    ...components
      .map((item) => ref(item))
      .flatMap((item) => (declared.has(item) ? [] : [{ ref: item, dependsOn: [] }])),
  ].sort((a, b) => (a.ref === root ? -1 : b.ref === root ? 1 : a.ref.localeCompare(b.ref)))

  const tools = [{ name: "kilo-sbom", version: input.product.version }, ...(input.tools ?? [])]

  return {
    bomFormat: "CycloneDX",
    specVersion: SPEC_VERSION,
    serialNumber: serial(input.subject.sha256),
    version: 1,
    metadata: {
      timestamp: timestamp(),
      lifecycles: [{ phase: "build" }],
      supplier: SUPPLIER,
      tools: {
        components: tools.map((tool) => ({
          type: "application",
          name: tool.name,
          ...(tool.version ? { version: tool.version } : {}),
        })),
      },
      component: {
        "bom-ref": root,
        type: input.product.type ?? "application",
        name: input.product.name,
        version: input.product.version,
        ...(input.product.description ? { description: input.product.description } : {}),
        ...(input.product.purl ? { purl: input.product.purl } : {}),
        supplier: SUPPLIER,
        ...(licenses(input.product.licenses) ? { licenses: licenses(input.product.licenses) } : {}),
        hashes: [{ alg: "SHA-256", content: input.subject.sha256 }],
      },
      properties: properties({
        "subject:name": input.subject.name,
        "subject:sha256": input.subject.sha256,
        "subject:size": input.subject.size == null ? undefined : String(input.subject.size),
        "release:version": input.product.version,
        "release:channel": input.build?.channel,
        "build:commit": input.build?.commit,
        "build:workflow": input.build?.workflow,
        "build:run": input.build?.run,
        "target:platform": input.target?.platform,
        "target:os": input.target?.os,
        "target:arch": input.target?.arch,
        "target:abi": input.target?.abi,
        "target:baseline": input.target?.baseline == null ? undefined : String(input.target.baseline),
        ...input.build?.properties,
        ...Object.fromEntries((input.gaps ?? []).map((gap) => [`coverage:gap:${gap.component}`, gap.reason])),
      }),
    },
    components: components.map(component),
    dependencies,
  }
}

export function serialize(bom: Bom) {
  return `${JSON.stringify(bom, null, 2)}\n`
}
