export * as KiloConfigValidate from "./validate.js"

import { applyEdits, findNodeAtLocation, modify, parse, parseTree } from "jsonc-parser"
import { ConfigNormalize } from "../../config/normalize.js"
import { KiloConfigPolicy } from "./policy.js"

// Write-side validation for a Kilo config document. The reader skips an unknown key or a malformed value with a
// diagnostic, so a write that only the reader checks would report success for a setting that never applies. A writer
// runs `check` on the edited text first and refuses the write when it lists an issue.

export interface Edit {
  readonly path: readonly string[]
  /** The new value; undefined removes the path. */
  readonly value: unknown
}

// `workflow_models` is derived from model-only `commands` entries; the reader ignores the key in a document.
const known = new Set(Object.keys(KiloConfigPolicy.Info.fields).filter((key) => key !== "workflow_models"))
const formatting = { tabSize: 2, insertSpaces: true } as const

/**
 * Top-level keys `set` writes that are not in the canonical v2 config schema. A reader-migrated legacy name (for
 * example `permission` or `autoupdate`) counts as unknown: a write uses the canonical name. A `null` value removes
 * the key, so it is allowed for any name.
 */
export function unknownKeys(set: Readonly<Record<string, unknown>>) {
  return Object.entries(set).flatMap(([key, value]) => (value === null || known.has(key) ? [] : [key]))
}

/**
 * Apply `edits` to `text` the way the writer does, preserving comments and formatting. A removal of an absent path is
 * skipped, as the writer skips it; an object set below a non-object node throws, so the caller expands it first.
 */
export function apply(text: string, edits: readonly Edit[]) {
  return edits.reduce((current, edit) => {
    const tree = parseTree(current)
    if (edit.value === undefined && (!tree || !findNodeAtLocation(tree, [...edit.path]))) return current
    return applyEdits(current, modify(current, [...edit.path], edit.value, { formattingOptions: formatting }))
  }, text)
}

/**
 * The issues the reader would report for `text` after `edits`, as `$.<path>: <message>`: every new issue, and every
 * issue on a path a `set` edit touches. An issue that was already reported elsewhere does not block an unrelated
 * write, and a removal never fails for the value it removes. Throws when `apply` cannot edit the text.
 */
export function check(text: string, edits: readonly Edit[]) {
  const existing = new Set(diagnose(text).map((item) => item.issue))
  const sets = edits.filter((edit) => edit.value !== undefined).map((edit) => edit.path)
  const touched = (path: readonly string[]) =>
    sets.some((set) => path[0] === "$" || set.every((part, index) => index >= path.length || path[index] === part))
  return [
    ...new Set(
      diagnose(apply(text, edits))
        .filter((item) => !existing.has(item.issue) || touched(item.path))
        .map((item) => item.issue),
    ),
  ]
}

function diagnose(text: string) {
  const input: unknown = parse(text, [], { allowTrailingComma: true })
  const normalized = ConfigNormalize.normalize(KiloConfigPolicy.normalize(input))
  const diagnostics = [...normalized.diagnostics]
  const info =
    normalized.type === "rejected"
      ? undefined
      : KiloConfigPolicy.parse(input, normalized.encoded, (diagnostic) => diagnostics.push(diagnostic))
  // A `conflict` means the native value won over a legacy one, so the written value still applies.
  const issues = diagnostics.filter((diagnostic) => diagnostic.kind !== "conflict").map((diagnostic) => ({
    path: diagnostic.path,
    issue: `${diagnostic.path[0] === "$" ? "$" : `$.${diagnostic.path.join(".")}`}: ${diagnostic.message}`,
  }))
  if (normalized.type !== "rejected" && !info)
    issues.push({ path: ["$"], issue: "$: rejected canonical configuration after final validation" })
  return issues
}
