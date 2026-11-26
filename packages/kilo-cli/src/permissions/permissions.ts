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

const DirectoryParam = Flag.String("directory").pipe(
  Flag.withDescription("Project directory (default: current directory)"),
  Flag.optional,
)

// Kilo's testing tools for project permission sets, in the upstream `debug` group: `debug permissions list|reset|check`.
export const PermissionsCommand = Spec.make("permissions", {
  description: "Inspect, reset or check project permission sets (testing tools)",
  commands: [
    Spec.make("list", {
      description: "List the project's saved permission grants, then the active permission set and its grants.",
      params: { ...ServerParams, directory: DirectoryParam },
    }),
    Spec.make("reset", {
      description:
        "Clear the project permission setup decision. Restart an open TUI to show automatic offers again. Pass --all to also remove the applied permission sets. Saved permission grants are never changed. Requires the permission_setup flag.",
      params: {
        ...ServerParams,
        all: Flag.Boolean("all").pipe(
          Flag.withDescription("Also remove the permission sets applied to this project"),
          Flag.withDefault(false),
        ),
        directory: DirectoryParam,
      },
    }),
    Spec.make("check", {
      description:
        "Check which shell commands in a file a project permission set does not grant. Reads one command per line; blank lines and lines starting with # are skipped.",
      params: {
        ...ServerParams,
        file: Argument.String("file").pipe(Argument.withDescription("File with one shell command per line")),
        preset: Flag.Literals("preset", KiloPermissionsRpc.PresetID.literals).pipe(
          Flag.withDescription("Permission set to check (default: the project's install set)"),
          Flag.optional,
        ),
        directory: DirectoryParam,
      },
    }),
  ],
})

// The RPC rejects with `{ type, message }`, its error name and text; Effect.tryPromise keeps the rejection as the cause.
export function failure(error: unknown) {
  const cause = error instanceof Error ? error.cause : error
  const type = typeof cause === "object" && cause !== null && "type" in cause ? cause.type : undefined
  if (type === "unavailable") return "permission setup is disabled (flag permission_setup)"
  if (type === "not_applicable") return "the permission set does not apply to this project"
  if (typeof cause === "object" && cause !== null && "message" in cause && typeof cause.message === "string")
    return type === undefined ? cause.message : `${String(type)}: ${cause.message}`
  return String(cause)
}
