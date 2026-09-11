import type { WorkspaceV2 } from "@opencode-ai/core/workspace" // kilocode_change
import { dispose } from "@/kilocode/effect/instance-registry" // kilocode_change

const disposers = new Set<(directory: string, workspaceID?: WorkspaceV2.ID) => Promise<void>>() // kilocode_change

// kilocode_change start
export function registerDisposer(
  disposer: (directory: string, workspaceID?: WorkspaceV2.ID) => Promise<void>, // kilocode_change
) {
  disposers.add(disposer)
  return () => {
    disposers.delete(disposer)
  }
}

export async function disposeInstance(directory: string, workspaceID?: WorkspaceV2.ID) {
  await dispose(directory, workspaceID, () =>
    Promise.allSettled([...disposers].map((disposer) => disposer(directory, workspaceID))),
  )
}
// kilocode_change end
