import type { WorkspaceV2 } from "@opencode-ai/core/workspace"

const before = new Set<(directory: string, workspaceID?: WorkspaceV2.ID) => undefined>()
const closing = new Map<string, number>()

export function registerBeforeDisposer(disposer: (directory: string, workspaceID?: WorkspaceV2.ID) => undefined) {
  before.add(disposer)
  return () => {
    before.delete(disposer)
  }
}

export function isDisposing(directory: string) {
  return closing.has(directory)
}

export async function dispose(directory: string, workspaceID: WorkspaceV2.ID | undefined, run: () => Promise<unknown>) {
  closing.set(directory, (closing.get(directory) ?? 0) + 1)
  try {
    const errors: unknown[] = []
    const guards = [...before]
    for (const disposer of guards) {
      try {
        disposer(directory, workspaceID)
      } catch (error) {
        errors.push(error)
      }
    }
    await run()
    if (errors.length) throw new AggregateError(errors, "Instance pre-disposal failed")
  } finally {
    const remaining = (closing.get(directory) ?? 1) - 1
    if (remaining) closing.set(directory, remaining)
    else closing.delete(directory)
  }
}
