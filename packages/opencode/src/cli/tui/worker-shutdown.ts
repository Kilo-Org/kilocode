// kilocode_change - new file
// Pure shutdown sequence for the embedded TUI worker. Extracted so unit tests can
// assert end → drain → dispose → stopServer ordering without loading worker.ts side effects.
export function createWorkerShutdown(input: {
  /** SessionEnd hooks; they run first, while sessions and config are still loaded. */
  end?: () => Promise<void>
  drain: () => Promise<void>
  dispose: () => Promise<void>
  stopServer: () => Promise<void>
}) {
  return async () => {
    if (input.end) await input.end()
    await input.drain()
    await input.dispose()
    await input.stopServer()
  }
}
