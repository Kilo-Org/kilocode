// kilocode_change - new file
// Names SessionPrompt.command intercepts before it looks a command up, so a command
// registered under one of them can never run. Skip those instead of failing: building
// the command list used to throw on a clash, and a single clashing name from config, a
// plugin, or an MCP server then hid every slash command from the client.
const NAMES = new Set(["goal"])

export type Source = "command" | "mcp"

export function reserved(name: string) {
  return NAMES.has(name)
}

export function notice(name: string, source: Source) {
  const owner = source === "mcp" ? "MCP prompt" : "custom command"
  return [
    `Ignoring the ${owner} named "${name}": /${name} is reserved for Kilo's own command.`,
    "Rename it, or disable it in the plugin that registers it, to stop this warning.",
  ].join(" ")
}
