export * as Manifest from "./manifest"

import { Diagnostic } from "./diagnostic"
import { Version } from "./version"

export interface Author {
  readonly name?: string
  readonly email?: string
  readonly url?: string
}

/** A validated `plugin.json`. Only fields the specification defines are kept (spec §5.2). */
export interface Info {
  readonly schema: string
  /** The Agent Plugins version selected by `$schema`. */
  readonly spec: Version.Id
  readonly name: string
  readonly version?: string
  readonly description?: string
  readonly author?: Author
  readonly homepage?: string
  readonly repository?: string
  readonly license?: string
  readonly keywords?: readonly string[]
  /** Client extension data by namespace. Values of namespaces this client does not implement are never validated. */
  readonly extensions?: Readonly<Record<string, unknown>>
}

export type Result =
  | { readonly type: "valid"; readonly manifest: Info; readonly diagnostics: readonly Diagnostic.Info[] }
  | { readonly type: "rejected"; readonly diagnostics: readonly Diagnostic.Info[] }

const NAME = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/
const STRINGS = ["version", "description", "homepage", "repository", "license"] as const
const KNOWN = new Set(["$schema", "name", ...STRINGS, "author", "keywords", "extensions"])
const AUTHOR = new Set(["name", "email", "url"])

/** True for a plugin name that satisfies spec §5.5. */
export function validName(name: string) {
  return name.length >= 1 && name.length <= 64 && NAME.test(name)
}

/**
 * Validates a parsed `plugin.json` value. Unknown top-level fields and a non-object `extensions` are reported and
 * ignored; every other violation rejects the plugin (spec §5.2, §8.1, §11.3).
 */
export function decode(value: unknown): Result {
  if (!isRecord(value)) return rejected("plugin.json must contain a JSON object")
  const warnings = Object.keys(value)
    .filter((key) => !KNOWN.has(key))
    .map((key) => Diagnostic.warning("manifest-unknown-field", `Ignored unknown plugin.json field "${key}"`))
  const schema = value.$schema
  if (typeof schema !== "string") return rejected('plugin.json requires a string "$schema"', warnings)
  const spec = Version.fromPluginSchema(schema)
  if (!spec)
    return {
      type: "rejected",
      diagnostics: [
        ...warnings,
        Diagnostic.error(
          "manifest-unsupported-version",
          `Unsupported Agent Plugins version "${schema}"; supported: ${Object.values(Version.supported)
            .map((item) => item.plugin)
            .join(", ")}`,
        ),
      ],
    }
  const name = value.name
  if (typeof name !== "string" || !validName(name))
    return rejected(
      typeof name === "string"
        ? `Invalid plugin name "${name}": use 1-64 lowercase letters, digits, hyphens and periods, starting and ending with a letter or digit, without "--" or ".."`
        : 'plugin.json requires a string "name"',
      warnings,
    )
  const wrong = STRINGS.find((key) => key in value && typeof value[key] !== "string")
  if (wrong) return rejected(`plugin.json field "${wrong}" must be a string`, warnings)
  if (
    "keywords" in value &&
    !(Array.isArray(value.keywords) && value.keywords.every((item) => typeof item === "string"))
  )
    return rejected('plugin.json field "keywords" must be an array of strings', warnings)
  if ("author" in value && !validAuthor(value.author))
    return rejected('plugin.json field "author" must be an object with only string "name", "email" and "url"', warnings)
  const extensions = "extensions" in value ? value.extensions : undefined
  const ignored =
    extensions !== undefined && !isRecord(extensions)
      ? [Diagnostic.warning("manifest-invalid-extensions", 'Ignored plugin.json "extensions": it must be an object')]
      : []
  return {
    type: "valid",
    manifest: {
      schema,
      spec,
      name,
      ...Object.fromEntries(STRINGS.flatMap((key) => (typeof value[key] === "string" ? [[key, value[key]]] : []))),
      ...(Array.isArray(value.keywords) ? { keywords: value.keywords as string[] } : {}),
      ...(isRecord(value.author) ? { author: value.author as Author } : {}),
      ...(isRecord(extensions) ? { extensions } : {}),
    },
    diagnostics: [...warnings, ...ignored],
  }
}

function validAuthor(value: unknown) {
  return isRecord(value) && Object.entries(value).every(([key, item]) => AUTHOR.has(key) && typeof item === "string")
}

function rejected(message: string, warnings: readonly Diagnostic.Info[] = []): Result {
  return { type: "rejected", diagnostics: [...warnings, Diagnostic.error("manifest-invalid", message)] }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
