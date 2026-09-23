/**
 * Production dependency closure from `bun.lock`.
 *
 * Kilo compiles its JavaScript into Bun single-file executables and minified
 * bundles, so scanning the shipped artifact cannot recover the npm packages that
 * went into it. The lockfile is the only complete, exact record of what was
 * compiled in. Resolving it here keeps SBOMs honest about compiled-in
 * dependencies while the physical artifact scan covers everything on disk.
 *
 * Dev dependencies are never included: they are not shipped, and listing them
 * would inflate Kilo's own vulnerability-handling surface with tooling that
 * users never receive.
 */

import fs from "node:fs"
import path from "node:path"
import type { Component, Gap } from "./model"

export type Lock = {
  lockfileVersion: number
  workspaces: Record<
    string,
    {
      name?: string
      version?: string
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
  >
  packages: Record<string, unknown[]>
  catalog?: Record<string, string>
  catalogs?: Record<string, Record<string, string>>
}

export type Platform = { os?: string; arch?: string; libc?: string }

type Info = {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  os?: string | string[]
  cpu?: string | string[]
  libc?: string | string[]
}

type Resolved = {
  key: string
  name: string
  version: string
  kind: "npm" | "workspace" | "other"
  integrity?: string
  info: Info
}

/** `bun.lock` is JSONC. Bun's module loader understands it; JSON.parse does not. */
export async function load(file: string) {
  const module = await import(path.resolve(file))
  return ((module as { default?: Lock }).default ?? module) as Lock
}

/**
 * Split a lockfile key into node_modules path segments, keeping `@scope/name`
 * together so nested resolution does not treat a scope as its own directory.
 */
export function segments(key: string) {
  const parts = key.split("/")
  const out: string[] = []
  let i = 0
  while (i < parts.length) {
    const part = parts[i]
    if (part.startsWith("@") && i + 1 < parts.length) {
      out.push(`${part}/${parts[i + 1]}`)
      i += 2
      continue
    }
    out.push(part)
    i += 1
  }
  return out
}

function identifier(value: string) {
  const at = value.lastIndexOf("@")
  if (at <= 0) return { name: value, version: "" }
  return { name: value.slice(0, at), version: value.slice(at + 1) }
}

function entry(lock: Lock, key: string): Resolved | undefined {
  const value = lock.packages[key]
  if (!Array.isArray(value) || typeof value[0] !== "string") return undefined
  const parsed = identifier(value[0])
  const info = (value.find((item) => typeof item === "object" && item !== null) ?? {}) as Info
  const integrity = value.slice(1).find((item) => typeof item === "string" && item.includes("-")) as string | undefined
  const kind = parsed.version.startsWith("workspace:") ? "workspace" : /^\d/.test(parsed.version) ? "npm" : "other"
  return {
    key,
    name: parsed.name,
    version: parsed.version,
    kind,
    info,
    integrity: kind === "npm" ? integrity : undefined,
  }
}

/** node_modules resolution: nearest nested copy wins, then walk up to the root. */
function resolve(lock: Lock, from: string, name: string) {
  const parts = from === "" ? [] : segments(from)
  for (let depth = parts.length; depth >= 0; depth--) {
    const key = [...parts.slice(0, depth), name].join("/")
    if (lock.packages[key]) return key
  }
  return undefined
}

/** npm allows `os`/`cpu`/`libc` to be a single string or an array. */
function list(value: string | string[] | undefined) {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function matches(value: string | string[] | undefined, target: string | undefined) {
  const values = list(value)
  if (!values.length || !target) return true
  const allow = values.filter((item) => !item.startsWith("!"))
  const deny = values.filter((item) => item.startsWith("!")).map((item) => item.slice(1))
  if (deny.includes(target)) return false
  return allow.length === 0 || allow.includes(target)
}

/** Optional native packages ship only for the platform actually being built. */
function applicable(info: Info, platform?: Platform) {
  if (!platform) return true
  const os = platform.os === "win32" ? "win32" : platform.os
  return matches(info.os, os) && matches(info.cpu, platform.arch) && matches(info.libc, platform.libc)
}

export type Closure = {
  components: Component[]
  dependencies: Record<string, string[]>
  roots: string[]
  gaps: Gap[]
}

export function purl(name: string, version: string) {
  const encoded = name.startsWith("@") ? `%40${name.slice(1)}` : name
  return `pkg:npm/${encoded}@${version}`
}

/**
 * Walk the shipped dependency graph of a workspace package.
 *
 * `workspace` is a `bun.lock` workspace path such as `packages/opencode`.
 * Workspace-internal packages are recorded as first-party components rather
 * than given fabricated npm purls, and their own dependencies are followed
 * because they are compiled into the same artifact.
 */
export function closure(input: { lock: Lock; workspace: string; platform?: Platform; root?: string }): Closure {
  const workspace = input.lock.workspaces[input.workspace]
  if (!workspace) throw new Error(`Unknown workspace ${input.workspace} in bun.lock`)

  const components = new Map<string, Component>()
  const dependencies = new Map<string, Set<string>>()
  const gaps: Gap[] = []
  const visited = new Set<string>()
  const roots: string[] = []

  const workspaceRefs = new Map<string, string>()
  for (const [dir, meta] of Object.entries(input.lock.workspaces)) {
    if (dir === "" || !meta.name) continue
    workspaceRefs.set(meta.name, `kilocode:workspace:${meta.name}@${meta.version ?? "0.0.0"}`)
  }

  const queue: { from: string; owner: string; deps: Record<string, string>; optional: boolean }[] = [
    {
      from: "",
      owner: input.root ?? `kilocode:workspace:${workspace.name}@${workspace.version ?? "0.0.0"}`,
      deps: { ...workspace.dependencies },
      optional: false,
    },
    {
      from: "",
      owner: input.root ?? `kilocode:workspace:${workspace.name}@${workspace.version ?? "0.0.0"}`,
      deps: { ...workspace.optionalDependencies },
      optional: true,
    },
  ]

  while (queue.length) {
    const task = queue.shift()!
    for (const name of Object.keys(task.deps)) {
      const key = resolve(input.lock, task.from, name)
      if (!key) {
        gaps.push({ component: name, reason: `not resolvable from ${task.from || "<root>"} in bun.lock` })
        continue
      }
      const resolved = entry(input.lock, key)
      if (!resolved) {
        gaps.push({ component: name, reason: `malformed bun.lock entry for ${key}` })
        continue
      }

      if (resolved.kind === "workspace") {
        const ref = workspaceRefs.get(resolved.name)
        const dir = resolved.version.slice("workspace:".length)
        const meta = input.lock.workspaces[dir]
        if (!ref || !meta) {
          gaps.push({ component: resolved.name, reason: `workspace ${dir} is missing from bun.lock` })
          continue
        }
        edge(dependencies, task.owner, ref)
        if (!components.has(ref)) {
          components.set(ref, {
            type: "library",
            name: resolved.name,
            version: meta.version ?? "0.0.0",
            ref,
            supplier: "Kilo Code",
            delivery: "contained",
            properties: { origin: "workspace", workspace: dir },
          })
          queue.push({ from: "", owner: ref, deps: { ...meta.dependencies }, optional: false })
          queue.push({ from: "", owner: ref, deps: { ...meta.optionalDependencies }, optional: true })
        }
        continue
      }

      if (task.optional && !applicable(resolved.info, input.platform)) continue

      const id = purl(resolved.name, resolved.version)
      edge(dependencies, task.owner, id)
      if (task.owner === (input.root ?? `kilocode:workspace:${workspace.name}@${workspace.version ?? "0.0.0"}`)) {
        roots.push(id)
      }
      if (visited.has(key)) continue
      visited.add(key)

      const platform = [resolved.info.os, resolved.info.cpu, resolved.info.libc]
        .map((value) => list(value).join("|"))
        .filter(Boolean)
        .join("/")
      components.set(id, {
        type: "library",
        name: resolved.name,
        version: resolved.version,
        purl: id,
        ref: id,
        delivery: "contained",
        ...(platform ? { platform } : {}),
        ...(resolved.integrity ? { properties: { integrity: resolved.integrity } } : {}),
      })

      queue.push({ from: key, owner: id, deps: { ...resolved.info.dependencies }, optional: false })
      queue.push({ from: key, owner: id, deps: { ...resolved.info.optionalDependencies }, optional: true })
    }
  }

  return {
    components: [...components.values()],
    dependencies: Object.fromEntries([...dependencies].map(([key, value]) => [key, [...value]])),
    roots: [...new Set(roots)],
    gaps,
  }
}

function edge(map: Map<string, Set<string>>, from: string, to: string) {
  const existing = map.get(from)
  if (existing) {
    existing.add(to)
    return
  }
  map.set(from, new Set([to]))
}

/** Bun's isolated-linker store uses `+` in place of a scope's `/`. */
function storeName(name: string) {
  return name.replace("/", "+")
}

/**
 * Look up a package inside Bun's isolated-linker store.
 *
 * CI's Linux/macOS runners install with plain `bun install --frozen-lockfile`
 * (see `.github/actions/setup-bun/action.yml`, which only forces
 * `--linker hoisted` on Windows), so they get Bun's default isolated layout: a
 * flat `<root>/<name>` symlink exists only for a package's own direct
 * dependents, and every other package -- most transitive dependencies in
 * practice -- lives solely in the shared content-addressable store at
 * `<root>/.bun/<name>@<version>[+hash]/node_modules/<name>`. The `+hash`
 * suffix appears when a package resolves differently per peer context, so the
 * version is matched as a prefix rather than an exact directory name.
 */
function fromStore(root: string, name: string, version: string) {
  const pattern = `.bun/${storeName(name)}@${version}*/node_modules/${name}/package.json`
  // `.bun` is a dot-directory; Bun.Glob skips those unless `dot` is set.
  const matches = [...new Bun.Glob(pattern).scanSync({ cwd: root, dot: true })].sort()
  return matches.length ? path.join(root, matches[0]) : undefined
}

/**
 * Add license and supplier data from the installed tree.
 *
 * `bun.lock` records resolution and integrity but not licences, and CRA
 * evidence is expected to carry licence identifiers. Packages that cannot be
 * resolved locally are reported as gaps instead of being left silently blank.
 */
export async function enrich(components: Component[], modules: string | string[]) {
  const roots = Array.isArray(modules) ? modules : [modules]
  const gaps: Gap[] = []
  const out: Component[] = []
  for (const item of components) {
    if (!item.purl || item.licenses?.length) {
      out.push(item)
      continue
    }
    // Bun hoists a package's own direct dependents to `<root>/<name>`, but
    // most transitive dependencies only exist in the isolated linker's shared
    // store; both are searched before reporting a gap.
    const flat = roots
      .map((root) => path.join(root, item.name, "package.json"))
      .find((candidate) => fs.existsSync(candidate))
    const manifest =
      flat ??
      (item.version
        ? roots
            .map((root) => fromStore(root, item.name, item.version!))
            .find((candidate): candidate is string => !!candidate)
        : undefined)
    if (!manifest) {
      gaps.push({ component: `${item.name}@${item.version}`, reason: "licence unknown: package not installed locally" })
      out.push(item)
      continue
    }
    const pkg = (await Bun.file(manifest)
      .json()
      .catch(() => undefined)) as
      | { license?: string | { type?: string }; licenses?: { type?: string }[]; description?: string; author?: unknown }
      | undefined
    const license =
      typeof pkg?.license === "string"
        ? pkg.license
        : (pkg?.license?.type ??
          pkg?.licenses
            ?.map((entry) => entry?.type)
            .filter(Boolean)
            .join(" OR "))
    if (!license) {
      gaps.push({ component: `${item.name}@${item.version}`, reason: "licence unknown: not declared by the package" })
    }
    const author = typeof pkg?.author === "string" ? pkg.author : (pkg?.author as { name?: string } | undefined)?.name
    out.push({
      ...item,
      ...(license ? { licenses: [license] } : {}),
      ...(pkg?.description ? { description: pkg.description } : {}),
      ...(author ? { author } : {}),
    })
  }
  return { components: out, gaps }
}
