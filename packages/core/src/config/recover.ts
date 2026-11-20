// kilocode_change - new file: recovers valid settings from an invalid configuration document
export * as ConfigRecover from "./recover"

import { Schema, SchemaIssue } from "effect"
import { type ParseError, printParseErrorCode } from "jsonc-parser"

type Segment = string | number
type Container = Record<string, unknown> | unknown[]
type Issue = { readonly path: readonly (PropertyKey | { readonly key: PropertyKey })[]; readonly message: string }

export interface Diagnostic {
  /** JSON path of the setting, for example `$.agents.reviewer.steps`, or `$` for the whole document. */
  readonly path: string
  readonly message: string
}

export type Result<A> =
  | { readonly type: "recovered"; readonly value: A; readonly diagnostics: readonly Diagnostic[] }
  | { readonly type: "rejected"; readonly diagnostics: readonly Diagnostic[] }

const options = { errors: "all", onExcessProperty: "ignore", propertyOrder: "original" } as const

/** Describes JSONC syntax errors as diagnostics naming the line and the column. */
export function syntax(text: string, errors: readonly ParseError[]): Diagnostic[] {
  return errors.map((error) => {
    const before = text.slice(0, error.offset).split("\n")
    const line = before.length
    const column = (before.at(-1)?.length ?? 0) + 1
    return { path: "$", message: `${printParseErrorCode(error.error)} at line ${line}, column ${column}` }
  })
}

/**
 * Decodes a configuration document so that one invalid value cannot discard the rest of it.
 *
 * Each decode failure names the values that failed validation. Those values are removed from a copy of the
 * input and the document is decoded again, so every setting that validates keeps applying while only the
 * offending values are reported. A document whose root is not an object is rejected as a whole.
 */
export function recover<S extends Schema.Codec<unknown, unknown, never, never>>(
  schema: S,
  input: unknown,
): Result<S["Type"]> {
  const decode = Schema.decodeUnknownResult(schema, options)
  let value: unknown = structuredClone(input)
  const diagnostics: Diagnostic[] = []
  // Each round drops at least one value or stops, so the loop is bounded by the size of the document.
  for (;;) {
    const decoded = decode(value)
    if (decoded._tag === "Success") return { type: "recovered", value: decoded.success, diagnostics }
    const issues = format(decoded.failure)
    const pruned = prune(value, issues, diagnostics)
    if (pruned === undefined)
      return { type: "rejected", diagnostics: [...diagnostics, { path: "$", message: summarize(issues) }] }
    value = pruned
  }
}

/** Removes every value an issue names. Two issues that resolve to the same entry report it once. */
function prune(input: unknown, issues: readonly Issue[], diagnostics: Diagnostic[]) {
  if (!rooted(input)) return undefined
  const targets = new Map<string, { path: Segment[]; message: string }>()
  for (const issue of issues) {
    const path = normalize(issue.path)
    if (!path.length) continue
    const target = locate(input, boundary(path))
    if (target === undefined) continue
    const key = target.map(String).join("\u0000")
    if (targets.has(key)) continue
    targets.set(key, { path: target, message: issue.message })
  }
  if (!targets.size) return undefined
  const next: unknown = structuredClone(input)
  // Highest index first, so removing one array item does not shift the index of another removal.
  const ordered = [...targets.values()].toSorted((left, right) => compare(right.path, left.path))
  for (const target of ordered) {
    if (!drop(next, target.path)) continue
    diagnostics.push({ path: render(target.path), message: target.message })
    // A map entry that kept no field holds nothing, so a typo does not leave an empty named entry behind.
    const entry = target.path.slice(0, -1)
    const value = valueAt(next, entry)
    if (entry.length > 1 && rooted(value) && !Object.keys(value).length) drop(next, entry)
  }
  return next
}

function valueAt(root: unknown, path: readonly Segment[]): unknown {
  let current: unknown = root
  for (const segment of path) {
    if (!container(current) || !holds(current, segment)) return undefined
    current = lookup(current, segment)
  }
  return current
}

/**
 * The value to remove for one failing path. A list item is atomic, so an invalid field drops the item that
 * holds it; a map entry keeps its valid fields and reports the single field that failed. Anything deeper
 * reports the map entry, which is the smallest unit a document author can act on.
 */
function boundary(path: readonly Segment[]): Segment[] {
  const index = path.findIndex((segment) => typeof segment === "number")
  if (index !== -1) return path.slice(0, index + 1)
  return path.slice(0, 3)
}

/** Removes a map entry that kept no field, so a typo cannot create an empty named entry. */
function dropEmptyEntries(input: Record<string, unknown>) {
  for (const value of Object.values(input)) {
    if (!rooted(value)) continue
    for (const [key, entry] of Object.entries(value)) {
      if (rooted(entry) && !Object.keys(entry).length) delete value[key]
    }
  }
}

/**
 * Returns the path whose removal changes the document. A failing value is removed directly; when the failing
 * field is absent, the entry that should have held it is removed instead, because an absent key holds nothing
 * to drop.
 */
function locate(root: unknown, path: readonly Segment[]): Segment[] | undefined {
  for (let length = path.length; length > 0; length -= 1) {
    const candidate = path.slice(0, length)
    if (present(root, candidate)) return candidate
  }
  return undefined
}

function present(root: unknown, path: readonly Segment[]): boolean {
  let current: unknown = root
  for (const segment of path) {
    if (!container(current) || !holds(current, segment)) return false
    current = lookup(current, segment)
  }
  return true
}

function drop(root: unknown, path: readonly Segment[]): boolean {
  const parent = path.slice(0, -1).reduce<unknown>((current, segment) => {
    return container(current) && holds(current, segment) ? lookup(current, segment) : undefined
  }, root)
  const last = path.at(-1)
  if (last === undefined || !container(parent) || !holds(parent, last)) return false
  if (Array.isArray(parent)) {
    parent.splice(Number(last), 1)
    return true
  }
  delete parent[String(last)]
  return true
}

function container(value: unknown): value is Container {
  return typeof value === "object" && value !== null
}

function rooted(value: unknown): value is Record<string, unknown> {
  return container(value) && !Array.isArray(value)
}

function holds(value: Container, segment: Segment) {
  if (Array.isArray(value)) return typeof segment === "number" && segment >= 0 && segment < value.length
  return Object.hasOwn(value, segment)
}

function lookup(value: Container, segment: Segment): unknown {
  if (Array.isArray(value)) return typeof segment === "number" ? value[segment] : undefined
  return value[String(segment)]
}

function normalize(path: readonly (PropertyKey | { readonly key: PropertyKey })[]): Segment[] {
  return path.flatMap((segment): Segment[] => {
    const key = typeof segment === "object" && segment !== null ? segment.key : segment
    return typeof key === "number" ? [key] : [String(key)]
  })
}

function compare(left: readonly Segment[], right: readonly Segment[]) {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index]!
    const b = right[index]!
    if (a === b) continue
    if (typeof a === "number" && typeof b === "number") return a - b
    return String(a).localeCompare(String(b))
  }
  return left.length - right.length
}

function format(error: Schema.SchemaError): Issue[] {
  return SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues.map((issue) => ({
    path: issue.path ?? [],
    message: issue.message,
  }))
}

function summarize(issues: readonly Issue[]) {
  if (!issues.length) return "expected an object"
  return issues
    .map((issue) => {
      const path = normalize(issue.path)
      return path.length ? `${render(path)} ${issue.message}` : issue.message
    })
    .join("; ")
}

function render(path: readonly Segment[]) {
  return path.reduce<string>((text, segment) => {
    return typeof segment === "number" ? `${text}[${segment}]` : `${text}.${segment}`
  }, "$")
}
