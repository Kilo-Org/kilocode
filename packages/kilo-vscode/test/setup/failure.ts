// Await a promise and return its rejection message, or undefined when it resolves.
// Use this instead of `expect(promise).rejects`: that matcher waits in a nested event loop,
// and on Windows that loop does not fire pending timers or process exits, so the test hangs.
export function failure(promise: Promise<unknown>) {
  return promise.then(
    () => undefined,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )
}
