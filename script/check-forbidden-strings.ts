#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Greps tracked files for forbidden strings that must not appear in the repo.
 *
 * Each entry is a literal substring (no regex / globs) plus a one-line reason.
 * If a hit is genuinely legitimate (e.g. inside upstream-merge tooling), fix the
 * call site rather than weakening the rule -- the list is intentionally
 * narrow so it stays low-noise.
 */

import { spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
const SELF = path.relative(ROOT, import.meta.path).replaceAll("\\", "/")

// Each entry: pattern (literal substring) + reason + optional allow list of path
// prefixes where the string is legitimate (e.g. docs describing the fork lineage,
// upstream-merge tooling, generated source-link manifests).
const forbidden: { pattern: string; reason: string; allow?: string[] }[] = [
  { pattern: "opncd.ai/s/", reason: "legacy upstream share URL pattern" },
  {
    pattern: "github.com/anomalyco/opencode",
    reason: "upstream repo URL -- should be Kilo-Org/kilocode",
    allow: [
      "AGENTS.md",
      "README.md",
      ".opencode/glossary/",
      "packages/kilo-vscode/AGENTS.md",
      "packages/kilo-docs/source-links.md",
      "patches/",
      "script/upstream/",
    ],
  },
  {
    pattern: "sst/opencode",
    reason: "old upstream org path -- should be Kilo-Org/kilocode",
    allow: [".kilo/agent/upstream-merge.md", "script/upstream/"],
  },
  { pattern: `"HTTP-Referer": "https://opencode.ai/"`, reason: "attributes outbound LLM traffic to upstream" },
  { pattern: `"http-referer": "https://opencode.ai/"`, reason: "attributes outbound LLM traffic to upstream" },
  { pattern: "Tell OpenCode what to do differently", reason: "direct-mode permission UI uses upstream branding" },
  { pattern: "until OpenCode is restarted", reason: "permission copy uses upstream branding" },
  { pattern: "OpenCode's managed cache", reason: "Scout tool description uses upstream branding" },

  // Candidates -- enable once the underlying call sites have been rebranded.
  // Each one currently fires on real leaks; uncomment after fixing the listed
  // file(s) (and add an allowlist if there are unavoidable legitimate hits).
  //
  // { pattern: "opencode.ai/auth", reason: "upstream auth URL -- providers.ts opencode-provider help text" },
  // { pattern: "opencode.ai/go", reason: "upstream upsell URL -- dialog-go-upsell.tsx" },
  // { pattern: "opencode.ai/docs", reason: "upstream docs URL -- config.ts schema descriptions, providers.ts cloudflare help" },
  // { pattern: "opencode.ai/tui.json", reason: "upstream-hosted schema URL -- tui-migrate.ts" },
  // { pattern: `?? "https://opncd.ai"`, reason: "default share base URL still points at upstream -- share-next.ts" },
  // { pattern: "opencode.ai/theme.json", reason: "upstream-hosted theme JSON-Schema URL -- theme/*.json $schema fields" },
  // { pattern: "opencode.ai/desktop-theme.json", reason: "upstream-hosted desktop theme schema URL" },
]

const isAllowed = (file: string, allow?: string[]) => {
  if (!allow) return false
  return allow.some((prefix) => file === prefix || file.startsWith(prefix))
}

const ls = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "buffer" })
if (ls.status !== 0) {
  console.error(ls.stderr?.toString().trim() || "git ls-files failed")
  process.exit(1)
}

const files = ls.stdout
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .filter((f) => f !== SELF)

const hits: string[] = []
for (const file of files) {
  const buf = Bun.file(path.join(ROOT, file))
  if (!(await buf.exists())) continue
  // Skip binary-ish files: read as text and skip if it contains a NUL byte.
  const text = await buf.text().catch(() => null)
  if (text === null) continue
  if (text.includes("\0")) continue
  for (const f of forbidden) {
    if (isAllowed(file, f.allow)) continue
    let idx = 0
    while (true) {
      const at = text.indexOf(f.pattern, idx)
      if (at === -1) break
      const line = text.slice(0, at).split("\n").length
      hits.push(`${file}:${line}: ${f.pattern} (${f.reason})`)
      idx = at + f.pattern.length
    }
  }
}

if (hits.length === 0) {
  console.log(`check-forbidden-strings: ${files.length} file(s) checked, no forbidden strings found.`)
  process.exit(0)
}

console.error("Found forbidden strings:")
for (const h of hits) console.error(`  ${h}`)
process.exit(1)
