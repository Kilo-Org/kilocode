/**
 * `bun.lock` reading and node_modules resolution.
 *
 * Kept free of third-party imports so lightweight CI jobs (for example the
 * dependency submission workflow) can read the lockfile without running
 * `bun install` first.
 */

import path from "node:path"

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

export type Info = {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  os?: string | string[]
  cpu?: string | string[]
  libc?: string | string[]
}

export type Resolved = {
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
  const out: string[] = []
  for (const part of key.split("/")) {
    const last = out.at(-1)
    if (last?.startsWith("@") && !last.includes("/")) {
      out[out.length - 1] = `${last}/${part}`
      continue
    }
    out.push(part)
  }
  return out
}

function identifier(value: string) {
  const at = value.lastIndexOf("@")
  if (at <= 0) return { name: value, version: "" }
  return { name: value.slice(0, at), version: value.slice(at + 1) }
}

export function entry(lock: Lock, key: string): Resolved | undefined {
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
export function resolve(lock: Lock, from: string, name: string) {
  const parts = from === "" ? [] : segments(from)
  for (let depth = parts.length; depth >= 0; depth--) {
    const key = [...parts.slice(0, depth), name].join("/")
    if (lock.packages[key]) return key
  }
  return undefined
}

export function purl(name: string, version: string) {
  const encoded = name.startsWith("@") ? `%40${name.slice(1)}` : name
  return `pkg:npm/${encoded}@${version}`
}
