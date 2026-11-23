// kilocode_change - new file
// SessionPrompt.command intercepts `/goal` before it looks a command up, so a command
// registered under that name can never run under that name. Rather than dropping it,
// expose it as `name:command` -- the same source-suffix convention skills (`:skill`) and
// MCP prompts (`:mcp`) already use -- so the workflow stays reachable.
//
// `goal` is the only such name. The other built-in session commands (`compact`,
// `summarize`) are resolved through the registry rather than intercepted, so a command
// may legitimately use those names. MCP prompts cannot clash either: McpCatalog keys
// them as `<client>:<prompt>`, which never equals a bare command name.
export function reserved(name: string) {
  return name === "goal"
}

export function alias(name: string) {
  return `${name}:command`
}

type Entry = {
  template?: string
  description?: string
  agent?: string
  model?: string
  variant?: string
  subtask?: boolean
}

/**
 * The alias key a reserved command should register under, or undefined when there is
 * nothing to register.
 *
 * Undefined when the entry has no `template`: that is a partial override (it only tweaks
 * fields on an existing command), and there is no existing `goal:command` target to apply
 * it to.
 *
 * Undefined when an explicit `name:command` entry already defines its own `template`: that
 * entry owns the alias, so the auto-registered one must not replace it. Checked against the
 * config record rather than the registry so the result does not depend on object key order.
 */
export function rename(commands: Record<string, Entry> | undefined, name: string) {
  const entry = commands?.[name]
  if (entry?.template === undefined) return undefined
  if (commands?.[alias(name)]?.template !== undefined) return undefined
  return alias(name)
}

export function notice(name: string, key?: string) {
  return [
    `Ignoring the "${name}" command registered by your config or a plugin:`,
    `/${name} is reserved for Kilo's own command.`,
    key ? `Run yours as /${key} instead.` : "",
    "Rename it, or turn it off in the plugin that registers it, to stop this warning.",
  ]
    .filter(Boolean)
    .join(" ")
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
export function warnings(commands: Record<string, Entry> | undefined) {
  return Object.keys(commands ?? {})
    .filter(reserved)
    .map((name) => ({ path: `command.${name}`, message: notice(name, rename(commands, name)) }))
}
