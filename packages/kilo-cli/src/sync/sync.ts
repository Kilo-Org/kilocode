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
  description:
    "Sync native sessions to https://session-sync.kiloapps.io by default while signed in. " +
    "Syncs sessions you create or continue after sync is on; continuing an existing session includes its historical snapshot. " +
    "Untouched history stays local. " +
    "Uploads persisted transcripts, pending input, instructions, and required assets, not credentials or environment variables. " +
    "Set session_sync: false in global kilo2.jsonc to pause capture and network for all workspaces and keep the cloud copy. " +
    "Re-enabling does not recapture completed history from the pause. Account changes pause pinned workspaces.",
  commands: [
    Spec.make("enable", {
      description:
        "Enable session sync globally; sync transcripts, pending input, instructions, and required assets",
      params: {
        ...params,
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
      description: "Disable session capture and uploads globally without deleting the cloud copy",
      params,
    }),
    Spec.make("status", { description: "Show workspace synchronization state and pending work", params }),
    Spec.make("flush", { description: "Attempt to upload pending workspace changes", params }),
  ],
})
