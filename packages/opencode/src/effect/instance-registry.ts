import type { WorkspaceV2 } from "@opencode-ai/core/workspace" // kilocode_change

const disposers = new Set<(directory: string, workspaceID?: WorkspaceV2.ID) => Promise<void>>() // kilocode_change

// kilocode_change start
const beforeDisposers = new Set<(directory: string, workspaceID?: WorkspaceV2.ID) => undefined>()
const closing = new Map<string, number>()

export function registerBeforeDisposer(disposer: (directory: string, workspaceID?: WorkspaceV2.ID) => undefined) {
  beforeDisposers.add(disposer)
  return () => {
    beforeDisposers.delete(disposer)
  }
}

export function isDisposing(directory: string) {
  return closing.has(directory)
}

export function registerDisposer(
  disposer: (directory: string, workspaceID?: WorkspaceV2.ID) => Promise<void>, // kilocode_change
) {
  disposers.add(disposer)
  return () => {
    disposers.delete(disposer)
  }
}

export async function disposeInstance(directory: string, workspaceID?: WorkspaceV2.ID) {
  closing.set(directory, (closing.get(directory) ?? 0) + 1)
  try {
    const errors: unknown[] = []
    const guards = [...beforeDisposers]
    for (const disposer of guards) {
      try {
        disposer(directory, workspaceID)
      } catch (error) {
        errors.push(error)
      }
    }
    await Promise.allSettled([...disposers].map((disposer) => disposer(directory, workspaceID)))
    if (errors.length) throw new AggregateError(errors, "Instance pre-disposal failed")
  } finally {
    const remaining = (closing.get(directory) ?? 1) - 1
    if (remaining) closing.set(directory, remaining)
    else closing.delete(directory)
  }
}
// kilocode_change end
