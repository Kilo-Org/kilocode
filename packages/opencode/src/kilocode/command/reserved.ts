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

/**
 * Config warnings for reserved names, derived from the config on every read rather than
 * recorded while it loads. A plugin registers its commands by mutating the loaded config,
 * which happens after the config is read, so a clash cannot be collected during loading.
 * Deriving it on read is what carries a plugin's clash into the config-warning UI every
 * client already has.
 *
 * Reading on demand needs no ordering against the command list: InstanceBootstrap awaits
 * `plugin.init()` before an instance is handed out, so plugin commands are already in
 * config by the time any client can ask for warnings.
 *
 * Only config-sourced names appear here. An MCP prompt is not part of config, so that clash
 * stays a log warning from Command.state.
 */
export function warnings(commands: Record<string, unknown> | undefined) {
  return Object.keys(commands ?? {})
    .filter(reserved)
    .map((name) => ({ path: `command.${name}`, message: notice(name, "command") }))
}
