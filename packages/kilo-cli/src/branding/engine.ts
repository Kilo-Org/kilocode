export * as KiloBrandingEngine from "./engine"

import { parseSync, types } from "@babel/core"
import { KiloBrandingRules } from "./rules"

type Node = { type: string; start?: number | null; end?: number | null; [key: string]: unknown }

/** One unprotected user-visible text span: a string-literal inner, template text, or JSX text. */
export interface Span {
  start: number
  end: number
  raw: string
  bareStringLiteral: boolean
}

/**
 * Parse a module and return its normalized source and every unprotected
 * user-visible text span. This is the one place that decides what counts as
 * branding-eligible text (string literals, template text, JSX text, minus the
 * protected code contexts), shared by the rebrander and the branding audit.
 * A `.txt` prompt template is bundled as a string and read by the model, so
 * its whole content is one user-visible span.
 */
export function userVisibleSpans(filePath: string, source: string): { normalized: string; spans: Span[] } {
  const normalized = source.replaceAll("\r\n", "\n")
  if (filePath.endsWith(".txt"))
    return {
      normalized,
      spans: [{ start: 0, end: normalized.length, raw: normalized, bareStringLiteral: false }],
    }
  const file = parseSync(normalized, {
    filename: filePath,
    sourceType: "module",
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: filePath.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"] },
  })
  const program = (file as { program?: Node } | null)?.program
  if (!program) throw new Error(`Kilo branding could not parse ${filePath}`)

  const spans: Span[] = []
  const visit = (node: Node, parent: Node | null, grand: Node | null) => {
    if (node.type === "StringLiteral" && typeof node.start === "number" && typeof node.end === "number") {
      if (!isProtected(node, parent))
        spans.push({
          start: node.start + 1,
          end: node.end - 1,
          raw: normalized.slice(node.start + 1, node.end - 1),
          bareStringLiteral: true,
        })
    } else if (
      (node.type === "TemplateElement" || node.type === "JSXText") &&
      typeof node.start === "number" &&
      typeof node.end === "number"
    ) {
      // The static text of a template that names a trace span is part of the name.
      if (!grand || spanName(grand) !== parent)
        spans.push({
          start: node.start,
          end: node.end,
          raw: normalized.slice(node.start, node.end),
          bareStringLiteral: false,
        })
    }
    for (const key of types.VISITOR_KEYS[node.type] ?? []) {
      const child = node[key]
      if (Array.isArray(child)) {
        for (const item of child) if (isNode(item)) visit(item, node, parent)
      } else if (isNode(child)) visit(child, node, parent)
    }
  }
  visit(program, null, null)
  return { normalized, spans }
}

// Rebrand the user-visible text of one module. The source is parsed so the
// rules only ever touch string literals, template text and JSX text; every
// other byte — imports, identifiers, structure — is preserved exactly by
// slicing the original source at the span offsets rather than re-printing the
// AST.
export function brandText(filePath: string, source: string): string {
  const { normalized, spans } = userVisibleSpans(filePath, source)
  const edits = spans.flatMap((span) => {
    const branded = KiloBrandingRules.brandSpan(span.raw, { bareStringLiteral: span.bareStringLiteral })
    return branded === span.raw ? [] : [{ start: span.start, end: span.end, value: branded }]
  })
  edits.sort((a, b) => b.start - a.start)
  let out = normalized
  for (const edit of edits) out = out.slice(0, edit.start) + edit.value + out.slice(edit.end)
  return out
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as Node).type === "string"
}

// A string literal is protected when it is code data rather than display text:
// a module specifier, an equality operand, the search pattern of a string
// search/replace call, or a trace span name. These read like branding but are
// matched or emitted verbatim at runtime, so renaming them changes behavior (for
// example the OAuth seam's `.replaceAll("OpenCode", ...)` pattern, or a shell-rc
// marker compared with `===`).
const EQUALITY = new Set(["===", "!==", "==", "!="])
const SEARCH_METHODS = new Set([
  "replace",
  "replaceAll",
  "split",
  "match",
  "matchAll",
  "search",
  "includes",
  "startsWith",
  "endsWith",
  "indexOf",
  "lastIndexOf",
])

function isProtected(node: Node, parent: Node | null): boolean {
  if (!parent) return false
  if (
    (parent.type === "ImportDeclaration" ||
      parent.type === "ExportNamedDeclaration" ||
      parent.type === "ExportAllDeclaration" ||
      parent.type === "ImportExpression") &&
    parent.source === node
  )
    return true
  if (parent.type === "TSImportType" && parent.argument === node) return true
  if (parent.type === "BinaryExpression" && EQUALITY.has(parent.operator as string)) return true
  if (parent.type === "CallExpression") {
    if (spanName(parent) === node) return true
    const callee = parent.callee as Node | undefined
    const args = parent.arguments as Node[] | undefined
    if (callee?.type !== "MemberExpression" || args?.[0] !== node) return false
    return SEARCH_METHODS.has(((callee.property as Node | undefined)?.name as string) ?? "")
  }
  return false
}

// The argument that names a trace span, when `node` is a call that takes one. Telemetry groups by the name and no
// person or model reads it as product text, so it stays what upstream emits:
//
//   - `Effect.fn("OpenCodeTools.Plugin")`: the first argument. Only on `Effect`, because `fn` is a common method name
//     and `ui.fn("OpenCode hint")` takes text.
//   - `<receiver>.withSpan("name", options)` on any receiver (`Effect`, `Stream`, `Layer`, a tracer): the first
//     argument when it is a string, otherwise the second when that is one, the data-first
//     `Effect.withSpan(self, "name")`.
//
// Only that argument is the name. A string in the options of the same call is still text.
function spanName(node: Node) {
  if (node.type !== "CallExpression") return undefined
  const callee = node.callee as Node | undefined
  if (callee?.type !== "MemberExpression") return undefined
  const method = (callee.property as Node | undefined)?.name
  const args = (node.arguments as Node[] | undefined) ?? []
  const candidates =
    method === "withSpan"
      ? args.slice(0, 2)
      : method === "fn" && (callee.object as Node | undefined)?.name === "Effect"
        ? args.slice(0, 1)
        : []
  return candidates.find((arg) => arg.type === "StringLiteral" || arg.type === "TemplateLiteral")
}
