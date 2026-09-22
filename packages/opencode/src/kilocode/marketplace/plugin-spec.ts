import { parsePluginSpecifier } from "@/plugin/shared"

// Marketplace plugin items key installed state by catalog id, while the installed
// config stores a package spec. Resolve both to the same npm package name so
// install, detection, and removal agree on the identity.
export function pluginPackageName(spec: unknown): string | undefined {
  if (typeof spec === "string") return parsePluginSpecifier(spec).pkg || undefined
  if (Array.isArray(spec) && typeof spec[0] === "string") return parsePluginSpecifier(spec[0]).pkg || undefined
  return undefined
}
