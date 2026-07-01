// kilocode_change start — LLM command-approval classifier (issue #9138)

/**
 * Tools that are always safe and never reach the classifier — read-only or
 * metadata-only. Mirrors Claude Code's SAFE_YOLO_ALLOWLISTED_TOOLS.
 *
 * NOTE: ids must match ToolRegistry tool ids. Verify against the registry as
 * the tool set evolves; unknown-but-safe tools simply fall through to the
 * classifier (fail-safe direction).
 */
const SAFE_TOOLS = new Set<string>([
  // read-only file / search
  "read",
  "grep",
  "glob",
  "list",
  "lsp",
  "codesearch",
  "codebase_search",
  // network read-only
  "websearch",
  // task/plan metadata
  "todoread",
  "todowrite",
])

export function isSafeAllowlisted(tool: string): boolean {
  return SAFE_TOOLS.has(tool)
}

// kilocode_change end
