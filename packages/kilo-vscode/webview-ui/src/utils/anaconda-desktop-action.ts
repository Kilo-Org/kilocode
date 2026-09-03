import type { ExtensionMessage, WebviewMessage } from "../types/messages"
import type {
  AnacondaDesktopError,
  AnacondaDesktopRequest,
  AnacondaDesktopResult,
} from "../../../src/shared/anaconda-desktop-messages"

type Transport = {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

type RequestInput<T> = T extends { requestId: string } ? Omit<T, "requestId"> : never

type Handlers = {
  onStatus?: (message: Extract<AnacondaDesktopResult, { type: "anacondaDesktopStatusResult" }>) => void
  onOpened?: (message: Extract<AnacondaDesktopResult, { type: "anacondaDesktopOpened" }>) => void
  onSynced?: (message: Extract<AnacondaDesktopResult, { type: "anacondaDesktopSynced" }>) => void
  onError?: (message: AnacondaDesktopError) => void
}

export function createAnacondaDesktopAction(vscode: Transport) {
  const pending = new Map<string, Handlers>()
  const unsubscribe = vscode.onMessage((message) => {
    if (!message.type.startsWith("anacondaDesktop") || !("requestId" in message)) return
    const handlers = pending.get(message.requestId)
    if (!handlers) return
    pending.delete(message.requestId)

    if (message.type === "anacondaDesktopStatusResult") handlers.onStatus?.(message)
    if (message.type === "anacondaDesktopOpened") handlers.onOpened?.(message)
    if (message.type === "anacondaDesktopSynced") handlers.onSynced?.(message)
    if (message.type === "anacondaDesktopActionError") handlers.onError?.(message)
  })

  function send(message: RequestInput<AnacondaDesktopRequest>, handlers: Handlers = {}) {
    const requestId = crypto.randomUUID()
    pending.set(requestId, handlers)
    vscode.postMessage({ ...message, requestId } as AnacondaDesktopRequest)
    return requestId
  }

  function clear(requestId?: string) {
    const ids = requestId ? [requestId] : [...pending.keys()]
    for (const id of ids) {
      if (!pending.delete(id)) continue
      vscode.postMessage({ type: "cancelAnacondaDesktopRequest", requestId: id })
    }
  }

  function dispose() {
    clear()
    unsubscribe()
  }

  return { clear, send, dispose }
}
