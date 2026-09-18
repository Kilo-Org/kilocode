import { AbsolutePath } from "@opencode-ai/core/schema"
import { Location } from "@opencode-ai/core/location"
import { Pty } from "@opencode-ai/core/pty"
import { Effect } from "effect"

export function clearPtys(directory: string, workspaceID: Location.Ref["workspaceID"]) {
  return Effect.promise(() =>
    Pty.terminateDirectory(
      Location.Ref.make({
        directory: AbsolutePath.make(directory),
        workspaceID,
      }),
    ),
  )
}
