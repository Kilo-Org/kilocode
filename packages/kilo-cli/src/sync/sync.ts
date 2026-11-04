import { Spec } from "@opencode/cli/framework/spec"
import { Argument, Flag } from "effect/cli"

const params = {
  standalone: Flag.Boolean("standalone").pipe(
    Flag.withDescription("Run with a private server instead of the background service"),
    Flag.withDefault(false),
  ),
  server: Flag.String("server").pipe(
    Flag.withDescription("Connect to a server URL instead of the background service"),
    Flag.optional,
  ),
  directory: Argument.String("directory").pipe(
    Argument.withDescription("Workspace directory (default: current directory)"),
    Argument.optional,
  ),
  json: Flag.Boolean("json").pipe(
    Flag.withDescription("Print synchronization status as JSON"),
    Flag.withDefault(false),
  ),
}

export const SyncCommand = Spec.make("sync", {
  description: "Synchronize opted-in native sessions and private assets to a cloud destination",
  commands: [
    Spec.make("enable", {
      description: "Upload existing and future workspace transcripts, pending input, instructions, and required assets",
      params: {
        ...params,
        url: Flag.String("url").pipe(Flag.withDescription("Destination session-sync service URL (HTTPS required)")),
        local: Flag.Boolean("local").pipe(
          Flag.withDescription("Allow HTTP only for an explicitly selected loopback destination"),
          Flag.withDefault(false),
        ),
        organization: Flag.String("organization").pipe(
          Flag.withDescription("Organization ID (default: active gateway organization, or personal account)"),
          Flag.optional,
        ),
        assets: Flag.String("allow-asset").pipe(
          Flag.withDescription(
            "Authorize pinning and uploading this exact legacy asset file (repeat for each file; no directories)",
          ),
          Flag.atLeast(0),
        ),
      },
    }),
    Spec.make("disable", {
      description: "Stop workspace uploads without deleting the cloud copy",
      params,
    }),
    Spec.make("status", { description: "Show workspace synchronization consent and pending work", params }),
    Spec.make("flush", { description: "Attempt to upload pending workspace changes", params }),
  ],
})
