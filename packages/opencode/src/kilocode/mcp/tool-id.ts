// The one definition of the CLI's MCP tool-id naming.
//
// Both the registration of an MCP tool name and the permission key of a migrated legacy mode
// that grants one MCP server's tools are built here, so a migrated grant always names the tools
// the CLI registers. The module is a leaf on purpose: the legacy migrator reads it without
// loading the MCP client, the SDK, or `effect`.

/**
 * Replace every character the tool-id syntax cannot carry with `_`.
 *
 * The `u` flag makes the replacement count a whole code point, matching the plugin's
 * `String.replaceAll("[^a-zA-Z0-9_-]", "_")`, which also works per code point. Without it a
 * name holding a character outside the Basic Multilingual Plane (two UTF-16 units) would lose
 * one `_` per unit here and one `_` per character in the plugin, so the two keys would differ.
 */
export function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/gu, "_")
}

/** The name the CLI registers for a tool of an MCP server. */
export function toolName(client: string, name: string): string {
  return sanitize(client) + "_" + sanitize(name)
}

/** The permission glob covering every tool of one MCP server, `<server>_*`. */
export function pattern(server: string): string {
  // Two server names that differ only in an unsupported character collide here (`a.b` and `a_b`
  // both yield `a_b_*`), which is expected: the CLI registers their tools under one such name too.
  return sanitize(server) + "_*"
}
