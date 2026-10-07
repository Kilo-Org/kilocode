// kilocode_change - new file
// SessionPrompt.command intercepts `/goal` before it looks a command up, so a command
// registered under that name can never run. Skip it instead of failing: building the
// command list used to throw on a clash, and a single clashing name from config or a
// plugin then hid every slash command from the client.
//
// `goal` is the only such name. The other built-in session commands (`compact`,
// `summarize`) are resolved through the registry rather than intercepted, so a command
// may legitimately use those names. MCP prompts cannot clash either: McpCatalog keys
// them as `<client>:<prompt>`, which never equals a bare command name.
export function reserved(name: string) {
  return name === "goal"
}

export function notice(name: string) {
  return [
    `Ignoring the "${name}" command registered by your config or a plugin:`,
    `/${name} is reserved for Kilo's own command.`,
    "Rename it, or turn it off in the plugin that registers it, to stop this warning.",
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
 */
export function warnings(commands: Record<string, unknown> | undefined) {
  return Object.keys(commands ?? {})
    .filter(reserved)
    .map((name) => ({ path: `command.${name}`, message: notice(name) }))
}
