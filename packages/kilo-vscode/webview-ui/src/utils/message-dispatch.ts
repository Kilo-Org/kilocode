// Isolated fan-out for extension → webview messages (#16497).
//
// Every VS Code message is delivered to every onMessage subscriber. Without
// isolation, one throwing subscriber aborts the shared forEach, silently
// starving every handler registered after it — IPC-dependent controls then
// look frozen even though the webview renderer itself is alive. Keeping this
// framework-free makes the failure-isolation contract unit testable.

export type MessageHandler<T> = (message: T) => void

export function dispatchToHandlers<T>(handlers: ReadonlySet<MessageHandler<T>>, message: T): void {
  handlers.forEach((handler) => {
    try {
      handler(message)
    } catch (error) {
      console.error("[Kilo New] message handler failed", error)
    }
  })
}
