#!/usr/bin/env bun

// Branding coverage audit. Runs the rule engine over the user-facing CLI/TUI surface,
// `packages/server/src` and `packages/core/src` (its modules and the prompt templates
// the model reads), and hard-fails when it finds user-visible OpenCode text that would
// ship un-rebranded. Three failure modes:
//
//   - missing interception: a file the rules WOULD brand that is not in the loader's
//     `files` list, so its OpenCode text ships raw;
//   - rule gap: an intercepted file where, after the rules run, a user-visible
//     OpenCode/opencode token still remains;
//   - namespace leak: a core or Kilo plugin source or bundled text asset (prompt,
//     skill, command template) that, after the full transform, still puts a
//     built-in tool under the `opencode` namespace or tells the model to call
//     `tools.opencode.*`. The rule engine leaves dotted IDs alone and the
//     structural counts only guard known anchors, so a new upstream tool or a new
//     `tools.opencode.<name>` reference would otherwise ship un-rebranded.
//
// It reads the committed working tree, not the pinned upstream tree, so it sees what
// actually ships: a shared file Kilo patches (for example mcp/add.ts, which uses
// KiloConfigFiles through a kilocode_change seam) is audited as patched, not as
// upstream wrote it. Known, reviewed non-branding occurrences live in the baseline
// allowlist (branding-audit-allow.ts), by whole file or by exact identity snippet; an
// entry that no longer accounts for a finding is stale and fails the run too.

export * as KiloBrandingAudit from "./branding-audit"

import { $ } from "bun"
import path from "node:path"
import { KiloBranding } from "../src/branding/text"
import { KiloBrandingRules } from "../src/branding/rules"
import { KiloBrandingEngine } from "../src/branding/engine"
import { allow } from "./branding-audit-allow"

const repo = path.resolve(import.meta.dir, "../../..")
const PATHSPECS = ["packages/cli/src", "packages/tui/src", "packages/core/src", "packages/server/src"]
const INCLUDE = [
  /^packages\/cli\/src\/.*\.tsx?$/,
  /^packages\/tui\/src\/.*\.tsx?$/,
  // The server package's own literals: the expired pairing link, error messages and recovery hints. Text a
  // response takes from core or protocol modules is not scanned here.
  /^packages\/server\/src\/.*\.ts$/,
  // Every core module (tool descriptions, form and error text, the OAuth pages, what a provider plugin tells the
  // model), and the prompt templates bundled as strings, which the model reads as its own identity and instructions.
  /^packages\/core\/src\/.*\.(tsx?|txt)$/,
]
// The built-in tool namespace is defined in core and named in model-facing text
// across core and the Kilo plugin, including text assets bundled as strings
// (`.txt`/`.md` prompts and skills), so the namespace check covers all of them,
// not only the user-facing surface.
const NAMESPACE_PATHSPECS = ["packages/core/src", "packages/kilo-plugin/src"]
const NAMESPACE_INCLUDE = [/^packages\/(core|kilo-plugin)\/src\/.*\.(tsx?|txt|md)$/]
const NAMESPACE = /namespace: "opencode"|tools\.opencode\.|`opencode` namespace/g
const EXCLUDE = [
  /\.test\.tsx?$/,
  /\.d\.ts$/,
  /\.snap$/,
  /\/__snapshots__\//,
  /\/fixtures?\//,
  /\/kilocode\//,
  /\/storybook\//,
]

// A token brandSpan deliberately leaves: the bare executable name the host
// resolves at runtime (`command: "opencode"`, the OPENCODE_CLI_NAME fallback).
function deliberatelyBare(span: KiloBrandingEngine.Span) {
  return span.bareStringLiteral && span.raw === "opencode"
}

// OpenCode / standalone opencode still present after the rules ran. By
// construction brandSpan removes these, so a hit is a genuine rule gap.
const LEFTOVER = /OpenCode|(?<![@\w./-])opencode(?![\w./-])/

export interface Finding {
  file: string
  line: number
  column: number
  kind: "missing-interception" | "rule-gap" | "namespace-leak"
  snippet: string
}

function position(source: string, offset: number) {
  const before = source.slice(0, offset)
  const line = before.split("\n").length
  return { line, column: offset - before.lastIndexOf("\n") }
}

/** The unbranded user-visible text of one file, before the allowlist. */
export function auditFile(key: string, source: string): Finding[] {
  return review(key, KiloBrandingEngine.userVisibleSpans(`packages/${key}`, source), [])
}

// `keep` lists reviewed identity snippets (exact source text): what they cover is ignored, and every other string of
// the file is audited as usual.
function review(key: string, parsed: ReturnType<typeof KiloBrandingEngine.userVisibleSpans>, keep: readonly string[]) {
  const intercepted = KiloBranding.files.includes(key)
  // Blanked in place, so the offsets of the spans still hold and a kept name cannot join the text around it.
  const kept = keep.reduce((text, snippet) => text.replaceAll(snippet, "\0".repeat(snippet.length)), parsed.normalized)
  return parsed.spans.flatMap((span) => {
    const text = kept.slice(span.start, span.end)
    const branded = KiloBrandingRules.brandSpan(text, { bareStringLiteral: span.bareStringLiteral })
    const miss = !intercepted && branded !== text
    const gap = intercepted && !deliberatelyBare(span) && LEFTOVER.test(branded)
    if (!miss && !gap) return []
    const { line, column } = position(parsed.normalized, span.start)
    return [
      {
        file: key,
        line,
        column,
        kind: miss ? ("missing-interception" as const) : ("rule-gap" as const),
        snippet: span.raw.replaceAll("\n", " ").trim().slice(0, 80),
      },
    ]
  })
}

/** Flag every `opencode` tool-namespace reference that survives the full branding transform of a core module. */
export function auditNamespace(key: string, source: string): Finding[] {
  const branded = KiloBranding.transform(path.join(repo, "packages", key), source)
  return [...branded.matchAll(NAMESPACE)].map((match) => {
    const { line, column } = position(branded, match.index)
    return {
      file: key,
      line,
      column,
      kind: "namespace-leak" as const,
      snippet: branded.slice(match.index).split("\n")[0]!.slice(0, 80),
    }
  })
}

export interface AuditResult {
  scoped: number
  findings: Finding[]
  unexpected: Finding[]
  unparseable: { file: string; error: string }[]
  stale: string[]
}

/** The tracked files of the user-visible surface, as repo-relative paths. */
export function surface() {
  return scope(PATHSPECS, INCLUDE)
}

/**
 * One file against its allowlist entry: every finding, the ones the entry does not account for, and the identity
 * snippets that account for none. A snippet is stale when the audit reports the same without it: upstream moved or
 * reworded the identity, the loader now intercepts the file, or another snippet already covers it.
 */
export function check(key: string, source: string, entry = allow.get(key)) {
  const parsed = KiloBrandingEngine.userVisibleSpans(`packages/${key}`, source)
  const findings = review(key, parsed, [])
  if (entry === undefined) return { findings, unexpected: findings, stale: [] }
  if (typeof entry === "string") return { findings, unexpected: [], stale: [] }
  const snippets = entry.map(([snippet]) => snippet)
  const places = (keep: readonly string[]) =>
    review(key, parsed, keep)
      .map((finding) => `${finding.line}:${finding.column}`)
      .join()
  const reviewed = places(snippets)
  return {
    findings,
    unexpected: review(key, parsed, snippets),
    stale: snippets.filter((snippet) => places(snippets.filter((item) => item !== snippet)) === reviewed),
  }
}

/** Scan the committed working-tree surface and classify findings against the allowlist. */
export async function run(): Promise<AuditResult> {
  const scoped = await surface()
  const namespaced = await scope(NAMESPACE_PATHSPECS, NAMESPACE_INCLUDE)
  const read = async (file: string) => {
    const key = file.slice("packages/".length)
    return { key, source: await Bun.file(path.join(repo, file)).text() }
  }

  const text = (await Promise.all(scoped.map(read))).map((file) => ({
    key: file.key,
    result: safely(() => check(file.key, file.source)),
  }))
  // The identity snippets of a file name user-visible text, so they never account for a tool namespace.
  const namespace = (await Promise.all(namespaced.map(read))).map((file) => ({
    key: file.key,
    result: safely(() => {
      const findings = auditNamespace(file.key, file.source)
      return { findings, unexpected: typeof allow.get(file.key) === "string" ? [] : findings, stale: [] }
    }),
  }))
  const results = [...text, ...namespace].flatMap((item) => ("error" in item.result ? [] : [item.result]))
  const findings = results.flatMap((result) => result.findings)

  return {
    scoped: new Set([...scoped, ...namespaced]).size,
    findings,
    unexpected: results.flatMap((result) => result.unexpected),
    unparseable: [...text, ...namespace].flatMap((item) =>
      "error" in item.result ? [{ file: item.key, error: item.result.error }] : [],
    ),
    stale: [
      // A whole-file entry is stale without a finding in its file; a snippet entry, when its file left the surface.
      ...[...allow].flatMap(([file, entry]) =>
        (typeof entry === "string" ? findings.some((f) => f.file === file) : scoped.includes(`packages/${file}`))
          ? []
          : [file],
      ),
      ...text.flatMap((item) =>
        "error" in item.result ? [] : item.result.stale.map((snippet) => `${item.key}: ${JSON.stringify(snippet)}`),
      ),
    ],
  }
}

// A parse failure is not skipped silently: a user-facing file the audit cannot
// read leaves its branding unchecked, which is the regression the audit exists
// to prevent. The error is surfaced and fails the run.
function safely<A>(audit: () => A): A | { error: string } {
  try {
    return audit()
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

async function scope(pathspecs: string[], include: RegExp[]) {
  const tracked = (await $`git ls-files -z -- ${pathspecs}`.cwd(repo).quiet().text()).split("\0").filter(Boolean)
  return tracked.filter((file) => include.some((re) => re.test(file)) && !EXCLUDE.some((re) => re.test(file)))
}

async function main() {
  const { scoped, unexpected, unparseable, stale } = await run()

  if (unexpected.length === 0 && unparseable.length === 0 && stale.length === 0) {
    console.log(`branding-audit: ok (${scoped} files, ${allow.size} allowlisted)`)
    return
  }

  // A stale entry fails too: the text it was reviewed for moved or changed, so a person looks at it again.
  for (const entry of stale)
    console.error(`branding-audit: stale allowlist entry (accounts for no finding): packages/${entry}`)
  for (const u of unparseable) console.error(`branding-audit: could not parse packages/${u.file}: ${u.error}`)
  if (unexpected.length > 0) {
    console.error(`\nbranding-audit: ${unexpected.length} unbranded user-visible OpenCode occurrence(s):\n`)
    for (const f of unexpected)
      console.error(`  [${f.kind}] packages/${f.file}:${f.line}:${f.column}  ${JSON.stringify(f.snippet)}`)
    console.error(
      `\nFix each: add the file to KiloBranding.files (missing-interception), extend the rules (rules.ts) or the` +
        ` protected contexts (isProtected in engine.ts) for a rule-gap, add a namespace transform to structural.ts` +
        ` (and the file to KiloBranding.files) or correct the Kilo-owned text for a namespace-leak, or add a reviewed entry to` +
        ` branding-audit-allow.ts if the text is genuinely not Kilo branding: an exact identity snippet where the rest` +
        ` of the file is product text, the whole file only when all of it is.`,
    )
  }
  process.exit(1)
}

if (import.meta.main) await main()
