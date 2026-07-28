/**
 * Localization lint: unused translation keys (all Kilo-owned pools)
 *
 * Ensures every key in every Kilo-owned english dictionary is either
 * referenced from repository source or explicitly protected as a runtime
 * protocol key. Keys that lose their last usage during refactors tend to
 * linger in all 20 locale files forever; this test fails for review instead.
 *
 * Complements i18n-keys.test.ts, which checks the opposite direction
 * (t() calls referencing keys missing from the dictionaries).
 *
 * Covered pools:
 *   app           webview sidebar dict (webview-ui/src/i18n)
 *   kilo-i18n     shared webview overrides (packages/kilo-i18n)
 *   agent-manager agent manager webview dict
 *   cli-backend   extension server/remote dict
 *   host          extension host dict (autocomplete)
 *
 * The upstream @opencode-ai/ui dict (packages/ui/src/i18n) is intentionally
 * NOT covered: it is upstream-owned code where removals create merge
 * conflicts, and its keys may be consumed by upstream surfaces outside
 * this repo.
 *
 * This is intentionally conservative: false "used" results are acceptable,
 * but a live key must never be classified as unused. A key counts as used
 * when either:
 *   - a quoted string literal equal to the key appears in scanned code
 *     (covers t("key") calls, ternaries producing key strings, key strings
 *     embedded in the CLI backend that travel to the webview as data, e.g.
 *     provider metadata noteKeys in opencode/src/kilocode/provider), or
 *   - a template literal with a static dotted head ending right before ${}
 *     covers the key by prefix (e.g. t(`agentManager.setup.error.${code}`),
 *     t(`workStyle.choice.${choice}.title`), const k = `a.b.${x}`).
 *   - a quoted dotted prefix appears in production source (conservatively
 *     covering concatenation and indirect prefix reuse), or
 *   - the pool explicitly protects a runtime namespace used by backend
 *     payloads. Add indirect/external keys there rather than deleting them.
 */

import { describe, it, expect } from "bun:test"
import { Glob } from "bun"
import path from "node:path"

import { dict as appEn } from "../../webview-ui/src/i18n/en"
import { dict as kiloEn } from "../../../kilo-i18n/src/en"
import { dict as amEn } from "../../webview-ui/agent-manager/i18n/en"
import { dict as cliEn } from "../../src/services/cli-backend/i18n/en"
import { dict as hostEn } from "../../src/services/i18n/en"

const REPO = path.resolve(import.meta.dir, "../../../..")
const VSCODE = path.join(REPO, "packages/kilo-vscode")

// Webview key strings are consumed not only in the webview itself but also
// embedded as data in the CLI backend / extension host (provider metadata,
// question flows), so those sources are scanned for webview pools too.
const WEBVIEW_ROOTS = [
  VSCODE,
  path.join(REPO, "packages/kilo-ui"),
  path.join(REPO, "packages/opencode"),
  path.join(REPO, "packages/kilo-gateway"),
]

const pools = [
  { name: "app", dict: appEn, roots: WEBVIEW_ROOTS, runtime: ["settings.providers.note."] },
  // kilo-i18n also overrides upstream ui.* keys consumed by components in
  // packages/ui/src (and the TUI), so those count as usage too.
  {
    name: "kilo-i18n",
    dict: kiloEn,
    roots: [...WEBVIEW_ROOTS, path.join(REPO, "packages/ui"), path.join(REPO, "packages/tui")],
    runtime: ["plan.followup.", "snapshot.slowRepo.", "settings.providers.note."],
  },
  { name: "agent-manager", dict: amEn, roots: WEBVIEW_ROOTS, runtime: ["agentManager.setup.error."] },
  { name: "cli-backend", dict: cliEn, roots: [VSCODE], runtime: [] },
  { name: "host", dict: hostEn, roots: [VSCODE], runtime: [] },
] as const

const EXACT_RE = /["'`]([a-zA-Z][a-zA-Z0-9_]*(?:[.:][a-zA-Z0-9_]+)+)["'`]/g
const DYNAMIC_RE = /`([a-zA-Z][a-zA-Z0-9_]*(?:[.:][a-zA-Z0-9_]+)*[.:])\$\{/g
const PREFIX_RE = /["'`]([a-zA-Z][a-zA-Z0-9_]*(?:[.:][a-zA-Z0-9_]+)*[.:])["'`]/g
const SOURCE_GLOB = "**/*.{ts,tsx,js,jsx,mjs,cjs,json,jsonc,json5,yaml,yml,toml,md,mdx,html,xml,properties,kt,kts,java}"
const SKIP = ["/i18n/", "/tests/", "/test/", "/node_modules/", "/dist/", "/out/", "/build/", "/coverage/", "/.turbo/"]

interface Usage {
  exact: Set<string>
  prefixes: Set<string>
}

const cache = new Map<string, Promise<Usage>>()

function scan(root: string): Promise<Usage> {
  const hit = cache.get(root)
  if (hit) return hit
  const job = (async (): Promise<Usage> => {
    const glob = new Glob(SOURCE_GLOB)
    const exact = new Set<string>()
    const prefixes = new Set<string>()
    for await (const file of glob.scan({ cwd: root, absolute: true })) {
      // skip the locale dictionaries themselves — they contain every key
      if (SKIP.some((part) => file.includes(part)) || file.includes(".test.") || file.includes(".spec.")) continue
      const text = await Bun.file(file).text()
      for (const match of text.matchAll(EXACT_RE)) {
        const key = match[1]
        if (!key) continue
        exact.add(key)
      }
      for (const match of text.matchAll(DYNAMIC_RE)) {
        if (match[1]) prefixes.add(match[1])
      }
      for (const match of text.matchAll(PREFIX_RE)) {
        if (match[1]) prefixes.add(match[1])
      }
    }
    return { exact, prefixes }
  })()
  cache.set(root, job)
  return job
}

async function unused(
  dict: Record<string, string>,
  roots: readonly string[],
  runtime: readonly string[],
): Promise<string[]> {
  const exact = new Set<string>()
  const prefixes = new Set<string>()
  for (const root of roots) {
    const usage = await scan(root)
    for (const key of usage.exact) exact.add(key)
    for (const key of usage.prefixes) prefixes.add(key)
  }
  return Object.keys(dict).filter((key) => {
    if (exact.has(key)) return false
    if (runtime.some((prefix) => key.startsWith(prefix))) return false
    for (const prefix of prefixes) {
      if (key.startsWith(prefix)) return false
    }
    return true
  })
}

describe("i18n — no unused keys", () => {
  for (const pool of pools) {
    it(`references every ${pool.name} dictionary key from code`, async () => {
      const dead = await unused(pool.dict, pool.roots, pool.runtime)
      const report = dead.map((key) => `  "${key}": "${pool.dict[key as keyof typeof pool.dict]}"`).join("\n")
      expect(
        dead,
        `Found ${dead.length} apparently unused ${pool.name} i18n key(s). Do not delete automatically: verify runtime/external consumers, then either add a source reference, protect the runtime namespace in this test, or remove the key from every locale:\n${report}`,
      ).toEqual([])
    })
  }
})
