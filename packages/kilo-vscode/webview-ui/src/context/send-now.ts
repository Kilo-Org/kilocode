import type { useVSCode } from "./vscode"

export function requestSendQueuedNow(
  vscode: Pick<ReturnType<typeof useVSCode>, "onMessage" | "postMessage">,
  sessionID: string,
  messageID: string,
  timeout = 10_000,
) {
  const requestID = crypto.randomUUID()
  const done = Promise.withResolvers<boolean>()
  const finish = (success: boolean) => {
    clearTimeout(timer)
    unsubscribe()
    done.resolve(success)
  }
  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "connectionState" && (message.state === "disconnected" || message.state === "error")) {
      finish(false)
      return
    }
    if (message.type === "sendQueuedNowResult" && message.requestID === requestID) finish(message.success)
  })
  const timer = setTimeout(() => finish(false), timeout)
  vscode.postMessage({ type: "sendQueuedNow", sessionID, messageID, requestID })
  return done.promise
}
