import { Spec } from "@opencode/cli/framework/spec"
import { KiloPermissionsRpc } from "@opencode/schema/kilocode/permissions"
import { Argument, Flag } from "effect/cli"

const ServerParams = {
  standalone: Flag.Boolean("standalone").pipe(
    Flag.withDescription("Run with a private server instead of the background service"),
    Flag.withDefault(false),
  ),
  server: Flag.String("server").pipe(
    Flag.withDescription("Connect to a server URL instead of the background service"),
    Flag.optional,
  ),
}

export const PermissionsCommand = Spec.make("permissions", {
  description: "Manage project permission setup",
  commands: [
    Spec.make("list", {
      description: "List the project's saved permission grants, then the active permission set and its grants.",
      params: {
        ...ServerParams,
        directory: Flag.String("directory").pipe(
          Flag.withDescription("Project directory (default: current directory)"),
          Flag.optional,
        ),
      },
    }),
    Spec.make("reset", {
      description:
        "Clear the project permission setup decision. Restart an open TUI to show automatic offers again. Pass --all to also remove the applied permission sets. Saved permission grants are never changed.",
      params: {
        ...ServerParams,
        all: Flag.Boolean("all").pipe(
          Flag.withDescription("Also remove the permission sets applied to this project"),
          Flag.withDefault(false),
        ),
        directory: Flag.String("directory").pipe(
          Flag.withDescription("Project directory (default: current directory)"),
          Flag.optional,
        ),
      },
    }),
  ],
})

// Kilo's command in the upstream `debug` group.
export const KiloDebugCommands = {
  permissions: Spec.make("permissions", {
    description:
      "Check which shell commands in a file a project permission set does not grant. Reads one command per line; blank lines and lines starting with # are skipped.",
    params: {
      ...ServerParams,
      file: Argument.String("file").pipe(Argument.withDescription("File with one shell command per line")),
      preset: Flag.Literals("preset", KiloPermissionsRpc.PresetID.literals).pipe(
        Flag.withDescription("Permission set to check (default: the project's install set)"),
        Flag.optional,
      ),
      directory: Flag.String("directory").pipe(
        Flag.withDescription("Project directory (default: current directory)"),
        Flag.optional,
      ),
    },
  }),
}
