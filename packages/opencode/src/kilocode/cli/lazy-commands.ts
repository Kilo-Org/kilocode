import type { Argv, ArgumentsCamelCase, CommandModule } from "yargs"

type Load<T, U> = () => Promise<CommandModule<T, U>>
const completion = process.argv.includes("--get-yargs-completions")
const tasks: Promise<void>[] = []
let selected = false

function build<T, U>(command: CommandModule<T, U>, args: Argv<T>) {
  if (!command.builder) return args as unknown as Argv<U>
  if (typeof command.builder === "function") return command.builder(args)
  return args.options(command.builder) as unknown as Argv<U>
}

export function waitForLazyCommands() {
  return Promise.all(tasks)
}

export function hasLazyCommandSelection() {
  return selected
}

export function lazy<T = {}, U = {}>(input: {
  command: string | readonly string[]
  aliases?: string | readonly string[]
  describe?: string | false
  load: Load<T, U>
}): CommandModule<T, U> {
  const state: { command?: CommandModule<T, U>; task?: Promise<CommandModule<T, U>> } = {}
  const load = () => (state.task ??= input.load())
  if (completion) {
    tasks.push(
      load().then((command) => {
        state.command = command
      }),
    )
  }
  return {
    command: input.command,
    aliases: input.aliases,
    describe: input.describe,
    builder: ((args: Argv<T>) => {
      selected = true
      if (state.command) return build(state.command, args)
      return load().then((command) => build(command, args))
    }) as never,
    async handler(args: ArgumentsCamelCase<U>) {
      const command = await load()
      await command.handler(args)
    },
  }
}

export const AcpCommand = lazy({
  command: "acp",
  describe: "start ACP (Agent Client Protocol) server",
  load: async () => (await import("@/cli/cmd/acp")).AcpCommand,
})

export const AttachCommand = lazy({
  command: "attach <url>",
  describe: "attach to a running kilo server",
  load: async () => (await import("@/cli/cmd/attach")).AttachCommand,
})

export const RunCommand = lazy({
  command: "run [message..]",
  describe: "run kilo with a message",
  load: async () => (await import("@/cli/cmd/run")).RunCommand,
})

export const GenerateCommand = lazy({
  command: "generate",
  load: async () => (await import("@/cli/cmd/generate")).GenerateCommand,
})

export const McpCommand = lazy({
  command: "mcp",
  describe: "manage MCP (Model Context Protocol) servers",
  load: async () => (await import("@/cli/cmd/mcp")).McpCommand,
})

export const DebugCommand = lazy({
  command: "debug",
  describe: "debugging and troubleshooting tools",
  load: async () => (await import("@/cli/cmd/debug")).DebugCommand,
})

export const ProvidersCommand = lazy({
  command: "auth",
  aliases: ["providers"],
  describe: "manage AI providers and credentials",
  load: async () => (await import("@/cli/cmd/providers")).ProvidersCommand,
})

export const AgentCommand = lazy({
  command: "agent",
  describe: "manage agents",
  load: async () => (await import("@/cli/cmd/agent")).AgentCommand,
})

export const UpgradeCommand = lazy({
  command: "upgrade [target]",
  describe: "upgrade kilo to the latest or a specific version",
  load: async () => (await import("@/cli/cmd/upgrade")).UpgradeCommand,
})

export const UninstallCommand = lazy({
  command: "uninstall",
  describe: "uninstall kilo and remove all related files",
  load: async () => (await import("@/cli/cmd/uninstall")).UninstallCommand,
})

export const ServeCommand = lazy({
  command: "serve",
  describe: "starts a headless kilo server",
  load: async () => (await import("@/cli/cmd/serve")).ServeCommand,
})

export const ModelsCommand = lazy({
  command: "models [provider]",
  describe: "list all available models",
  load: async () => (await import("@/cli/cmd/models")).ModelsCommand,
})

export const StatsCommand = lazy({
  command: "stats",
  describe: "show token usage and cost statistics",
  load: async () => (await import("@/cli/cmd/stats")).StatsCommand,
})

export const ExportCommand = lazy({
  command: "export [sessionID]",
  describe: "export session data as JSON",
  load: async () => (await import("@/cli/cmd/export")).ExportCommand,
})

export const ImportCommand = lazy({
  command: "import <file>",
  describe: "import session data from JSON file or URL",
  load: async () => (await import("@/cli/cmd/import")).ImportCommand,
})

export const SessionCommand = lazy({
  command: "session",
  describe: "manage sessions",
  load: async () => (await import("@/cli/cmd/session")).SessionCommand,
})

export const GithubCommand = lazy({
  command: "github",
  describe: "manage GitHub agent",
  load: async () => (await import("@/cli/cmd/github")).GithubCommand,
})

export const PrCommand = lazy({
  command: "pr",
  describe: "manage pull requests",
  load: async () => (await import("@/cli/cmd/pr")).PrCommand,
})

export const PluginCommand = lazy({
  command: "plugin <module>",
  aliases: ["plug"],
  describe: "install plugin and update config",
  load: async () => (await import("@/cli/cmd/plug")).PluginCommand,
})

export const DbCommand = lazy({
  command: "db",
  describe: "database tools",
  load: async () => (await import("@/cli/cmd/db")).DbCommand,
})
