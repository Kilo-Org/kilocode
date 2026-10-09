import { parsePluginSpecifier } from "@/plugin/shared"
import { gitPluginIdentity, isGitPluginSpec } from "@/kilocode/plugin/git-source"

// Marketplace plugin items key installed state by catalog id, while the installed
// config stores a package spec. Resolve both to the same identity so install,
// detection, and removal agree on it. npm specs use the package name; git specs
// use the scheme-free repo slug with the subpath retained.
export function pluginIdentity(spec: unknown): string | undefined {
  if (typeof spec === "string") return identity(spec)
  if (Array.isArray(spec) && typeof spec[0] === "string") return identity(spec[0])
  return undefined
}

function identity(spec: string): string | undefined {
  const value = spec.trim()
  if (!value) return undefined
  if (isGitPluginSpec(value)) return gitPluginIdentity(value)
  return parsePluginSpecifier(value).pkg || undefined
}
