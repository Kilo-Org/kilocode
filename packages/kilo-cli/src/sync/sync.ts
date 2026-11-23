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
    Spec.make("pull", {
      description:
        "Pull a synced session into this workspace under the same session ID. " +
        "A locally deleted session is restored from the synced copy. " +
        "With --replace-local, discard unsynced local messages and load the latest synced copy. " +
        "With --as-new, copy the local history of a session deleted on another device to a new session ID and upload it; the old ID stays deleted.",
      params: {
        standalone: params.standalone,
        server: params.server,
        json: params.json,
        sessionID: Argument.String("sessionID").pipe(Argument.withDescription("Synced session ID to pull")),
        directory: params.directory,
        replaceLocal: Flag.Boolean("replace-local").pipe(
          Flag.withDescription("Discard unsynced local messages and replace the local copy with the synced copy"),
          Flag.withDefault(false),
        ),
        asNew: Flag.Boolean("as-new").pipe(
          Flag.withDescription("Copy the local history to a new session ID, enroll and upload it"),
          Flag.withDefault(false),
        ),
      },
    }),
    Spec.make("delete", {
      description:
        "Delete a synced session everywhere (the synced copy and every device copy stop syncing). " +
        "This is separate from deleting a session locally, which keeps the synced copy.",
      params: {
        standalone: params.standalone,
        server: params.server,
        json: params.json,
        sessionID: Argument.String("sessionID").pipe(Argument.withDescription("Synced session ID to delete everywhere")),
        directory: params.directory,
      },
    }),
  ],
})