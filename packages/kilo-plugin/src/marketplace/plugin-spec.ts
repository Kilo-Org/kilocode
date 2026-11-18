import type npa from "npm-package-arg"
import { PluginGitSource } from "../plugin/git-source"

let parser: typeof npa | undefined

// A marketplace plugin item stores a package spec, while the owning installation is keyed by catalog id. Both
// resolve to one identity so install, status and removal agree on which config entry they own: npm specs use the
// package name, git specs use the scheme-free repo slug with the subpath retained, and local paths stay as
// written. Entries are read from config JSON, so a v1 tuple or a v2 `{ package }` entry is accepted too.
export async function pluginIdentity(value: unknown): Promise<string | undefined> {
  if (typeof value === "string") return identity(value)
  if (Array.isArray(value) && typeof value[0] === "string") return identity(value[0])
  if (value && typeof value === "object" && "package" in value && typeof value.package === "string")
    return identity(value.package)
  return undefined
}

async function identity(spec: string): Promise<string | undefined> {
  const value = spec.trim()
  if (!value) return undefined
  if (PluginGitSource.isGitPluginSpec(value)) return PluginGitSource.gitPluginIdentity(value)
  const parsed = await parse(value)
  if (parsed?.type === "alias" && !parsed.name) {
    const sub = (parsed as { subSpec?: { name?: string } }).subSpec
    if (sub?.name) return sub.name
  }
  return parsed?.name || value
}

async function parse(spec: string) {
  try {
    parser ??= (await import("npm-package-arg")).default
    return parser(spec)
  } catch {
    return undefined
  }
}
