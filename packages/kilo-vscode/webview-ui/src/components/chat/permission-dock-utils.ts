import type { PermissionRule } from "../../types/messages"

export type RuleDecision = "approved" | "denied" | "pending"

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
  todoread: "ui.permission.toolLabel.todoRead",
  todowrite: "ui.permission.toolLabel.todoWrite",
  task: "ui.permission.toolLabel.task",
  skill: "ui.permission.toolLabel.skill",
  lsp: "ui.permission.toolLabel.lsp",
}

export type PatternDescription = { kind: "single"; text: string } | { kind: "multi"; title: string; paths: string[] }

/** Resolve the human-readable label for a tool (e.g. "Read", "Web Fetch"). */
export function resolveLabel(tool: string, t: (key: string) => string): string {
  const key = TOOL_LABEL_KEYS[tool]
  return key ? t(key) : tool
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
  t: (key: string) => string,
): PatternDescription | null {
  const filtered = patterns.filter((p) => p !== "*")
  if (filtered.length === 0) return null

  const key = TOOL_LABEL_KEYS[tool]
  const label = key ? t(key) : tool
  if (filtered.length === 1) return { kind: "single", text: `${label} ${filtered[0]}` }
  return { kind: "multi", title: `${label}:`, paths: filtered }
}
