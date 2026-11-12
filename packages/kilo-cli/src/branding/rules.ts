export * as KiloBrandingRules from "./rules"

import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"

// The rule engine rebrands user-visible OpenCode text to Kilo. It runs over
// string literals, template text and JSX text only (see engine.ts), so code —
// `@opencode/*` imports, `opencode.*` identifiers, provider and theme IDs — is
// never rewritten. Rules are applied map -> product -> command per span, after
// the whole-file overrides below.

// Semantic rewrites that are Kilo product copy rather than a mechanical brand
// swap (for example, upgrades are disabled, so the upgrade description changes
// meaning). File-scoped and applied whole-file before the generic rules so a
// later OpenCode -> Kilo pass cannot pre-empt them. Few by design; like the
// structural transforms these are exact, so a reworded upstream anchor fails
// loud (`Kilo branding no longer matches`) and a human re-decides the Kilo copy
// — the audit cannot catch the drift, because the generic rule would otherwise
// brand the leftover token and leave nothing unbranded.
export const overrides = [
  {
    file: "cli/src/commands/commands.ts",
    from: "Upgrade OpenCode to the latest or a specific version",
    to: "Show manual Kilo update instructions",
  },
  { file: "cli/src/acp/service.ts", from: "Login with opencode", to: "Login with Kilo" },
  { file: "tui/src/app.tsx", from: "Update OpenCode", to: "Kilo update instructions" },
  // The lowercase product name as the agent's identity, which the command rule would turn into `kilo2`.
  {
    file: "core/src/plugin/system-prompt/trinity.txt",
    from: "You are opencode, an interactive",
    to: "You are Kilo, an interactive",
  },
] as const satisfies ReadonlyArray<{ file: string; from: string; to: string }>

// Exact fragments that are not a simple word swap: domains, the upstream repo,
// the config file name and the terminal-title prefix. Applied longest-first so
// a longer fragment wins over a shorter one it contains.
export const literals = [
  ["github.com/anomalyco/opencode", "github.com/Kilo-Org/kilocode"],
  ["opencode.json", KiloConfigFiles.newFile],
  ["opencode.ai", "kilo.ai"],
  ["OC | ", "Kilo | "],
] as const satisfies ReadonlyArray<readonly [string, string]>

const sortedLiterals = [...literals].sort((a, b) => b[0].length - a[0].length)

// The product name as a whole word. The capitalised form is display text, so a
// bare rename is safe.
const PRODUCT = /\bOpenCode\b/g

// The lowercase command name, as a standalone word. The negative lookbehind and
// lookahead keep it from firing inside `@opencode`, a dotted ID (`opencode.app`,
// `opencode.ai`), a path (`anomalyco/opencode`) or a hyphenated name, so only a
// command token in display text is renamed.
const COMMAND = /(?<![@\w./-])opencode(?![\w./-])/g

/**
 * Apply the generic rules to one user-visible text span. `bareStringLiteral`
 * marks a string literal whose entire value is the span, so the executable
 * anchor `"opencode"` (the `OPENCODE_CLI_NAME` fallback and the ACP
 * `command: "opencode"`) is left for the host to resolve at runtime.
 */
export function brandSpan(text: string, options: { bareStringLiteral: boolean }): string {
  let out = text
  for (const [from, to] of sortedLiterals) if (out.includes(from)) out = out.split(from).join(to)
  out = out.replace(PRODUCT, "Kilo")
  if (!(options.bareStringLiteral && text === "opencode")) out = out.replace(COMMAND, "kilo2")
  return out
}
