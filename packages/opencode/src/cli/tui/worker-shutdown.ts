// kilocode_change - new file
// Pure shutdown sequence for the embedded TUI worker. Extracted so unit tests can
// assert drain → dispose → stopServer ordering without loading worker.ts side effects.
export function createWorkerShutdown(input: {
  drain: () => Promise<void>
  dispose: () => Promise<void>
  stopServer: () => Promise<void>
}) {
  return async () => {
    await input.drain()
    await input.dispose()
    await input.stopServer()
  }
}
