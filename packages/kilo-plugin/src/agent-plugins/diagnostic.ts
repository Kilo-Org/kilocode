export * as Diagnostic from "./diagnostic"

/**
 * A problem found while loading a plugin. `error` marks something that was rejected or skipped, `warning` something
 * that was ignored while loading continued (spec §11.3 asks clients to report both).
 */
export interface Info {
  readonly severity: "error" | "warning"
  readonly code: Code
  readonly message: string
  /** The component type the problem belongs to; absent for plugin-level problems. */
  readonly component?: "skills" | "mcp"
  /** The skill directory name or MCP server name. */
  readonly item?: string
}

export type Code =
  | "root-invalid"
  | "manifest-missing"
  | "manifest-outside-root"
  | "manifest-invalid"
  | "manifest-unsupported-version"
  | "manifest-unknown-field"
  | "manifest-invalid-extensions"
  | "skills-invalid"
  | "skill-outside-root"
  | "skill-invalid"
  | "mcp-invalid"
  | "mcp-unsupported-version"
  | "mcp-version-mismatch"
  | "server-invalid"
  | "server-unsupported-transport"
  | "data-unavailable"
  // Reported by clients for their own decisions, not by the loader.
  | "extension-invalid"
  | "plugin-shadowed"
  | "server-unsupported"

export function error(code: Code, message: string, scope?: Pick<Info, "component" | "item">): Info {
  return { severity: "error", code, message, ...scope }
}

export function warning(code: Code, message: string, scope?: Pick<Info, "component" | "item">): Info {
  return { severity: "warning", code, message, ...scope }
}
