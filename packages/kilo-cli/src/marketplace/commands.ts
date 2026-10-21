// `kilo marketplace`: the CLI side of the Kilo marketplace (U-E2-23). The host adds this command to the upstream command
// tree in ./index (rung 2), so the upstream `commands.ts` stays unchanged. The handlers call the `kilocode.marketplace`
// RPC of the running server, like the TUI's `/marketplace`.
import { Commands } from "@opencode/cli/commands/commands"
import { Spec } from "@opencode/cli/framework/spec"
import { Argument, Flag } from "effect/cli"

const kind = Argument.ChoiceWithValue("kind", [
  ["skill", "skill"],
  ["mcp", "mcp"],
  ["agent", "agent"],
] as const).pipe(Argument.withDescription("Item kind: skill, mcp or agent"))

const project = Flag.Boolean("project").pipe(
  Flag.withDescription("Use this project's .kilo2 directory instead of the global config"),
  Flag.withDefault(false),
)

const registry = Flag.String("registry").pipe(
  Flag.withDescription("Registry of the item when more than one registry has it"),
  Flag.optional,
)

export const Marketplace = Spec.make("marketplace", {
  description: "Browse and install skills and MCP servers from marketplaces",
  aliases: ["market"],
  commands: [
    Spec.make("list", {
      description: "List marketplace items",
      params: {
        kind: kind.pipe(Argument.optional),
        search: Flag.String("search").pipe(
          Flag.withDescription("Filter by id, name, description or tag"),
          Flag.optional,
        ),
        refresh: Flag.Boolean("refresh").pipe(Flag.withDescription("Fetch the catalog again"), Flag.withDefault(false)),
      },
    }),
    Spec.make("installed", { description: "List items installed from marketplaces" }),
    Spec.make("registries", {
      description: "List marketplace registries, or turn one on or off",
      params: {
        enable: Flag.String("enable").pipe(Flag.withDescription("Registry id to turn on"), Flag.optional),
        disable: Flag.String("disable").pipe(Flag.withDescription("Registry id to turn off"), Flag.optional),
      },
    }),
    Spec.make("install", {
      description: "Install a marketplace item",
      params: {
        kind,
        id: Argument.String("id").pipe(Argument.withDescription("Item id, as shown by `marketplace list`")),
        project,
        registry,
        option: Flag.String("option").pipe(
          Flag.withDescription("Install option of an MCP server, for example NPX or Docker"),
          Flag.optional,
        ),
        param: Flag.KeyValuePair("param").pipe(
          Flag.withDescription("Parameter value of an MCP server, as KEY=value"),
          Flag.optional,
        ),
      },
    }),
    Spec.make("uninstall", {
      description: "Remove a marketplace item, inferring its scope when unambiguous",
      params: {
        kind,
        id: Argument.String("id").pipe(Argument.withDescription("Item id")),
        project,
        global: Flag.Boolean("global").pipe(
          Flag.withDescription("Remove the global installation instead of inferring the scope"),
          Flag.withDefault(false),
        ),
        registry,
      },
    }),
  ],
})

/** The upstream command tree with `marketplace` added. Only the root's children change; every upstream node is shared. */
export const KiloCommands = {
  ...Commands,
  commands: { ...Commands.commands, marketplace: Marketplace },
}
