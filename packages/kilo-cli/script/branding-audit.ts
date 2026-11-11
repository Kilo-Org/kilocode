#!/usr/bin/env bun

// Branding coverage audit. Runs the rule engine over the user-facing CLI/TUI/OAuth
// surface and hard-fails when it finds user-visible OpenCode text that would ship
// un-rebranded. Three failure modes:
//
//   - missing interception: a file the rules WOULD brand that is not in the loader's
//     `files` list, so its OpenCode text ships raw;
//   - rule gap: an intercepted file where, after the rules run, a user-visible
//     OpenCode/opencode token still remains;
//   - namespace leak: a core module that, after the full transform, still puts a
//     built-in tool under the `opencode` namespace or tells the model to call
//     `tools.opencode.*`. The rule engine leaves dotted IDs alone and the
//     structural counts only guard known anchors, so a new upstream tool or a new
//     `tools.opencode.<name>` reference would otherwise ship un-rebranded.
//
// It reads the committed working tree, not the pinned upstream tree, so it sees what
// actually ships: a shared file Kilo patches (for example mcp/add.ts, which uses
// KiloConfigFiles through a kilocode_change seam) is audited as patched, not as
// upstream wrote it. Known, reviewed non-branding occurrences live in the baseline
// allowlist (branding-audit-allow.ts).

export * as KiloBrandingAudit from "./branding-audit"

import { $ } from "bun"
import path from "node:path"
import { KiloBranding } from "../src/branding/text"
import { KiloBrandingRules } from "../src/branding/rules"
import { KiloBrandingEngine } from "../src/branding/engine"
import { allow } from "./branding-audit-allow"

const repo = path.resolve(import.meta.dir, "../../..")
const PATHSPECS = ["packages/cli/src", "packages/tui/src", "packages/core/src/oauth"]
const INCLUDE = [
  /^packages\/cli\/src\/.*\.tsx?$/,
  /^packages\/tui\/src\/.*\.tsx?$/,
  /^packages\/core\/src\/oauth\/.*\.ts$/,
]
// The built-in tool namespace is defined and referenced across core, so the
// namespace check covers every core module, not only the user-facing surface.
const NAMESPACE_PATHSPECS = ["packages/core/src"]
const NAMESPACE_INCLUDE = [/^packages\/core\/src\/.*\.tsx?$/]
const NAMESPACE = /namespace: "opencode"|tools\.opencode\./g
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

export function auditFile(key: string, source: string): Finding[] {
  const intercepted = KiloBranding.files.includes(key)
  const { normalized, spans } = KiloBrandingEngine.userVisibleSpans(`packages/${key}`, source)
  return spans.flatMap((span) => {
    const branded = KiloBrandingRules.brandSpan(span.raw, { bareStringLiteral: span.bareStringLiteral })
    const miss = !intercepted && branded !== span.raw
    const gap = intercepted && !deliberatelyBare(span) && LEFTOVER.test(branded)
    if (!miss && !gap) return []
    const { line, column } = position(normalized, span.start)
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

/** Scan the committed working-tree surface and classify findings against the allowlist. */
export async function run(): Promise<AuditResult> {
  const scoped = await scope(PATHSPECS, INCLUDE)
  const namespaced = await scope(NAMESPACE_PATHSPECS, NAMESPACE_INCLUDE)

  const findings: Finding[] = []
  const unparseable: { file: string; error: string }[] = []
  for (const [files, audit] of [
    [scoped, auditFile],
    [namespaced, auditNamespace],
  ] as const)
    for (const file of files) {
      const key = file.slice("packages/".length)
      const source = await Bun.file(path.join(repo, file)).text()
      const result = safeAudit(() => audit(key, source))
      if (Array.isArray(result)) findings.push(...result)
      else unparseable.push({ file: key, error: result.error })
    }

  return {
    scoped: new Set([...scoped, ...namespaced]).size,
    findings,
    unexpected: findings.filter((f) => !allow.has(f.file)),
    unparseable,
    stale: [...allow.keys()].filter((file) => !findings.some((f) => f.file === file)),
  }
}

// A parse failure is not skipped silently: a user-facing file the audit cannot
// read leaves its branding unchecked, which is the regression the audit exists
// to prevent. The error is surfaced and fails the run.
function safeAudit(audit: () => Finding[]): Finding[] | { error: string } {
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

  for (const file of stale) console.warn(`branding-audit: stale allowlist entry (no findings): ${file}`)

  if (unexpected.length === 0 && unparseable.length === 0) {
    console.log(`branding-audit: ok (${scoped} files, ${allow.size} allowlisted)`)
    return
  }

  for (const u of unparseable) console.error(`branding-audit: could not parse packages/${u.file}: ${u.error}`)
  if (unexpected.length > 0) {
    console.error(`\nbranding-audit: ${unexpected.length} unbranded user-visible OpenCode occurrence(s):\n`)
    for (const f of unexpected)
      console.error(`  [${f.kind}] packages/${f.file}:${f.line}:${f.column}  ${JSON.stringify(f.snippet)}`)
    console.error(
      `\nFix each: add the file to KiloBranding.files (missing-interception), extend the rules (rules.ts) or the` +
        ` protected contexts (isProtected in engine.ts) for a rule-gap, add a namespace transform to structural.ts` +
        ` (and the file to KiloBranding.files) for a namespace-leak, or add a reviewed entry to` +
        ` branding-audit-allow.ts if the text is genuinely not Kilo branding.`,
    )
  }
  process.exit(1)
}

if (import.meta.main) await main()
