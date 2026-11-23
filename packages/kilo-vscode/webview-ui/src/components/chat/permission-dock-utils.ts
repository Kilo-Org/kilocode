import type { PermissionRule } from "../../types/messages"

export type RuleDecision = "approved" | "denied" | "pending"

// Escape control characters and invisible format characters for display, so each surface shows
// exactly the characters the request carries. Invisible format characters belong to the same
// display policy as control characters: each one is shown as its literal escape, so text never
// depends on characters that render without width. The class covers every character Unicode marks
// Default_Ignorable or Format, plus the C0 and C1 controls and the line and paragraph separators.
// Both helpers serve every text surface of the approval card — skill-shell commands, bash
// commands, pattern paths, tool names, rule text and diff file names. Each escape writes `\x`
// below 0x100, `\u` up to 0xffff and `\u{...}` above. The webview can't import from @kilocode/cli,
// so this mirrors displayCommand in packages/opencode/src/kilocode/skills/display.ts; keep them in
// sync.
const CONTROL =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u115f-\u1160\u17b4-\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufffb\u{110bd}\u{110cd}\u{13430}-\u{1343f}\u{1bca0}-\u{1bca3}\u{1d173}-\u{1d17a}\u{e0000}-\u{e0fff}]/gu

function escape(ch: string) {
  if (ch === "\n") return "\\n"
  if (ch === "\r") return "\\r"
  if (ch === "\t") return "\\t"
  const code = ch.codePointAt(0) ?? 0
  if (code <= 0xff) return "\\x" + code.toString(16).padStart(2, "0")
  if (code <= 0xffff) return "\\u" + code.toString(16).padStart(4, "0")
  return "\\u{" + code.toString(16) + "}"
}

/** Single-line surface: LF/CR/TAB become `\n`/`\r`/`\t`, every other control and format char escapes. */
export function displayText(text: string) {
  return text.replace(CONTROL, escape)
}

/** Block surface: like displayText, but LF stays a real newline so multi-line text remains readable. */
export function displayLines(text: string) {
  return text.replace(CONTROL, (ch) => (ch === "\n" ? ch : escape(ch)))
}

/**
 * Check which rules are already saved in the user's config and return
 * their initial toggle states (approved/denied). Rules not found in
 * the config are omitted (they default to "pending").
 */
export function savedRuleStates(rules: string[], saved: PermissionRule | undefined): Record<number, RuleDecision> {
  const result: Record<number, RuleDecision> = {}
  for (let i = 0; i < rules.length; i++) {
    const pattern = rules[i]
    const action = typeof saved === "string" ? (pattern === "*" ? saved : undefined) : saved?.[pattern]
    if (action === "allow") result[i] = "approved"
    if (action === "deny") result[i] = "denied"
  }
  return result
}

/**
 * Resolve a rule entry's home prefix the way the backend does when it loads a config
 * file: `~/`, `~`, `$HOME/` and `$HOME` become the home directory of the process that
 * runs the rules. Mirrors `expand` in `packages/opencode/src/permission/index.ts`.
 * Without a home directory the entry is returned as written.
 */
function expandEntry(entry: string, home: string | undefined): string {
  if (home == null) return entry
  if (entry.startsWith("~/")) return home + entry.slice(1)
  if (entry === "~") return home
  if (entry.startsWith("$HOME/")) return home + entry.slice(5)
  if (entry.startsWith("$HOME")) return home + entry.slice(5)
  return entry
}

/**
 * Whether a workspace entry decides the commands of a row pattern. Mirrors
 * `packages/opencode/src/util/wildcard.ts` `match`, kept local because the webview
 * must not import backend modules: normalise both separators to `/`, escape the
 * entry, turn `*` into `.*` and `?` into `.`, anchor both ends, and make a trailing
 * ` *` optional so `touch *` also covers `touch`.
 *
 * The entry's home prefix is resolved first, because the backend expands it with the
 * home directory of the process that runs the rules before matching. That directory is
 * a property of the host, so the webview cannot compute it and the dock passes the one
 * the extension reported. While it is unknown, an entry in one of the forms
 * `expandEntry` resolves is treated as covering: it may decide the pattern once the
 * backend runs it, and a row never offers a control the prompt cannot honour.
 *
 * Case folds always. The evaluator folds on Windows and for macOS file rules and
 * compares exactly elsewhere, and the webview has no host platform value, so folding
 * everywhere keeps a row read-only whenever a workspace entry may decide it.
 */
function ruleCovers(entry: string, pattern: string, home?: string): boolean {
  if (home == null && (entry.startsWith("~/") || entry === "~" || entry.startsWith("$HOME"))) return true
  const value = pattern.replaceAll("\\", "/")
  let escaped = expandEntry(entry, home)
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"
  return new RegExp("^" + escaped + "$", "si").test(value)
}

/**
 * The rows this prompt can change: the merged global scope supplies the pattern,
 * the effective state matches that global entry, no workspace scope entry decides
 * the row, and no broader entry of the same merged global scope supplies the same
 * action for it.
 *
 * `global` is the merged global scope — every global config file combined, later
 * files winning. A broader entry with the same action continues to decide the
 * pattern, so such a row shows a state indicator and keeps that control off. A
 * scalar merged value is the tool-wide `*` entry, and a `*` key covers every pattern.
 *
 * `target` is the primary global file, the one the removal writes to first. A named
 * pattern is deleted from every global file that holds it, so a named row carries its
 * removal control wherever the pattern is saved. A wildcard row carries that control
 * when the primary global file holds its own entry, and shows a state indicator
 * otherwise.
 *
 * `home` is the home directory the rules run in, as reported by the extension. It
 * resolves a `~` or `$HOME` prefix on the entries compared against the row, because
 * the backend expands such an entry to that directory before it matches. The webview
 * cannot compute it, and while it is unknown an entry written with a home prefix is
 * treated as deciding the row.
 *
 * A row another scope decides shows a state indicator instead.
 */
export function removableRuleIndices(input: {
  rules: string[]
  global: PermissionRule | undefined
  target: PermissionRule | undefined
  workspace: PermissionRule | undefined
  effective: Record<number, RuleDecision>
  home?: string
}): Set<number> {
  const fromGlobal = savedRuleStates(input.rules, input.global)
  const result = new Set<number>()
  for (let i = 0; i < input.rules.length; i++) {
    const pattern = input.rules[i]
    // The saved-entry lookups compare the request pattern literally, because the
    // removal this prompt sends names request patterns. An entry written with a home
    // prefix is stored under that prefix, so the prompt cannot delete it, and the row
    // shows a state indicator instead of a control that would change nothing.
    const action =
      typeof input.global === "string" ? (pattern === "*" ? input.global : undefined) : input.global?.[pattern]
    if (action !== "allow" && action !== "deny") continue
    // A named pattern is deleted from every global file that holds it, so only the
    // wildcard row consults the primary file's own entry.
    const own =
      pattern !== "*" ||
      (typeof input.target === "string" ? input.target === action : input.target?.[pattern] === action)
    if (!own) continue
    if (coveredByWorkspace(input.workspace, pattern, input.home)) continue
    if (coveredByBroaderGlobal(input.global, pattern, action, input.home)) continue
    if (fromGlobal[i] === input.effective[i]) result.add(i)
  }
  return result
}

/**
 * Whether another entry of the merged global scope supplies the pattern with the same
 * action. The broader entry decides the pattern, so the row shows a state indicator.
 */
function coveredByBroaderGlobal(
  global: PermissionRule | undefined,
  pattern: string,
  action: "allow" | "deny",
  home?: string,
): boolean {
  // The scalar form is the tool-wide entry, so it is the row itself for `*` and a
  // broader entry for every other pattern.
  if (typeof global === "string") return pattern !== "*" && action === global
  if (!global) return false
  return Object.entries(global).some(
    ([key, value]) => key !== pattern && value === action && ruleCovers(key, pattern, home),
  )
}

/** Whether the workspace scope supplies an allow/deny entry that decides the row. */
function coveredByWorkspace(workspace: PermissionRule | undefined, pattern: string, home?: string): boolean {
  // The scalar form is the tool-wide default, so it decides every row. A value that
  // only asks decides nothing, like the per-pattern form.
  if (typeof workspace === "string") return workspace === "allow" || workspace === "deny"
  if (!workspace) return false
  return Object.entries(workspace).some(([key, value]) => {
    const decides = value === "allow" || value === "deny"
    return decides && ruleCovers(key, pattern, home)
  })
}

// ---------------------------------------------------------------------------
// Human-readable permission descriptions
// ---------------------------------------------------------------------------

/** Maps tool names to their i18n key for the human-readable label. */
export const TOOL_LABEL_KEYS: Record<string, string> = {
  read: "ui.permission.toolLabel.read",
  edit: "ui.permission.toolLabel.edit",
  write: "ui.permission.toolLabel.write",
  patch: "ui.permission.toolLabel.patch",
  multiedit: "ui.permission.toolLabel.edit",
  glob: "ui.permission.toolLabel.globSearch",
  grep: "ui.permission.toolLabel.grepSearch",
  list: "ui.permission.toolLabel.list",
  bash: "ui.permission.toolLabel.bash",
  external_directory: "ui.permission.toolLabel.externalDirectory",
  webfetch: "ui.permission.toolLabel.webFetch",
  websearch: "ui.permission.toolLabel.webSearch",
  codesearch: "ui.permission.toolLabel.codeSearch",
  browser_open: "ui.permission.toolLabel.browserOpen",
  todoread: "ui.permission.toolLabel.todoRead",
  todowrite: "ui.permission.toolLabel.todoWrite",
  task: "ui.permission.toolLabel.task",
  skill: "ui.permission.toolLabel.skill",
  lsp: "ui.permission.toolLabel.lsp",
}

export type PatternDescription = { kind: "single"; text: string } | { kind: "multi"; title: string; paths: string[] }

/**
 * Resolve the human-readable label for a tool (e.g. "Read", "Web Fetch"). An unknown tool has no
 * label key, so its own name is shown, and that name comes from the request itself.
 */
export function resolveLabel(tool: string, t: (key: string) => string): string {
  const key = TOOL_LABEL_KEYS[tool]
  return key ? t(key) : displayText(tool)
}

export function describeRule(
  tool: string,
  rule: string,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  if (tool === "doom_loop") {
    // The repeated tool name is model-supplied; resolveLabel escapes an unknown one.
    return t("ui.permission.doomLoop.rule", { tool: resolveLabel(rule, t) })
  }
  const label = resolveLabel(tool, t)
  return rule === "*" ? label : `${label} ${displayText(displayPattern(tool, rule))}`
}

// Browser navigation patterns carry a "navigate:" prefix so the rule matches the
// origin. Hide the prefix in the prompt; the saved rule keeps it.
function displayPattern(tool: string, rule: string) {
  if (tool !== "browser_open") return rule
  return rule.startsWith("navigate:") ? rule.slice("navigate:".length) : rule
}

/**
 * Build a human-readable description for a permission request's patterns.
 *
 * Returns null when there are no meaningful patterns to display (e.g. only "*").
 * For a single pattern: "Read src/app.ts"
 * For multiple patterns: { title: "Read:", paths: ["src/app.ts", "src/index.ts"] }
 */
export function describePatterns(
  tool: string,
  patterns: string[],
  t: (key: string, params?: Record<string, string>) => string,
): PatternDescription | null {
  const filtered = patterns.filter((p) => p !== "*")
  if (filtered.length === 0) return null

  // doom-loop requests always contain one repeated tool pattern.
  if (tool === "doom_loop") {
    return {
      kind: "single",
      text: t("ui.permission.doomLoop.prompt", { tool: resolveLabel(filtered[0], t) }),
    }
  }

  const label = resolveLabel(tool, t)
  if (filtered.length === 1)
    return { kind: "single", text: `${label} ${displayText(displayPattern(tool, filtered[0]))}` }
  return {
    kind: "multi",
    title: `${label}:`,
    paths: filtered.map((pattern) => displayText(displayPattern(tool, pattern))),
  }
}
