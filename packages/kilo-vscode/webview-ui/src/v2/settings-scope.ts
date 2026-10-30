export type SettingsScope = "global" | "project"

/**
 * A one-way gate for the first raw config read. `wait` holds until `open`, then later waiters resolve immediately.
 * `open` drains the queue once, so a repeated `configLoaded` does not resolve any waiter twice.
 */
export function createGate() {
  let open = false
  const waiters: (() => void)[] = []
  return {
    wait: () => {
      if (open) return Promise.resolve()
      return new Promise<void>((resolve) => waiters.push(resolve))
    },
    open: () => {
      open = true
      waiters.splice(0).forEach((resolve) => resolve())
    },
  }
}

/**
 * The file a write goes to. An explicit scope wins without consulting the files. Otherwise wait for the raw files,
 * which are unknown until the first `configLoaded`, then use the scope that owns the path, then global. A write that
 * starts before the files load would otherwise fall back to global and land in the file the project value shadows.
 */
export async function writeScope(
  scope: SettingsScope | undefined,
  waitForFiles: () => Promise<void>,
  owner: () => SettingsScope | undefined,
): Promise<SettingsScope> {
  if (scope) return scope
  await waitForFiles()
  return owner() ?? "global"
}
