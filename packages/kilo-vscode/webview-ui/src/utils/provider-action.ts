import type {
  AuthorizeProviderOAuthMessage,
  CompleteProviderOAuthMessage,
  ConnectProviderMessage,
  DisconnectProviderMessage,
  ExtensionMessage,
  ProviderActionErrorMessage,
  ProviderConnectedMessage,
  ProviderDisconnectedMessage,
  ProviderOAuthReadyMessage,
  SaveCustomProviderMessage,
  WebviewMessage,
} from "../types/messages"

type ProviderRequest =
  | ConnectProviderMessage
  | AuthorizeProviderOAuthMessage
  | CompleteProviderOAuthMessage
  | DisconnectProviderMessage
  | SaveCustomProviderMessage

type ProviderRequestInput =
  | Omit<ConnectProviderMessage, "requestId">
  | Omit<AuthorizeProviderOAuthMessage, "requestId">
  | Omit<CompleteProviderOAuthMessage, "requestId">
  | Omit<DisconnectProviderMessage, "requestId">
  | Omit<SaveCustomProviderMessage, "requestId">

type Transport = {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

type Handlers = {
  onOAuthReady?: (message: ProviderOAuthReadyMessage) => void
  onConnected?: (message: ProviderConnectedMessage) => void
  onDisconnected?: (message: ProviderDisconnectedMessage) => void
  onError?: (message: ProviderActionErrorMessage) => void
  /** Called when no reply arrives within `timeout` ms. Later replies for the request are ignored. */
  onTimeout?: () => void
  timeout?: number
}

type Entry = Handlers & { timer?: ReturnType<typeof setTimeout> }

export function createProviderAction(vscode: Transport) {
  const pending = new Map<string, Entry>()

  function take(requestId: string) {
    const item = pending.get(requestId)
    if (!item) return
    pending.delete(requestId)
    clearTimeout(item.timer)
    return item
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (!("requestId" in message)) return

    const item = take(message.requestId)
    if (!item) return

    if (message.type === "providerOAuthReady") {
      item.onOAuthReady?.(message)
      return
    }

    if (message.type === "providerConnected") {
      item.onConnected?.(message)
      return
    }

    if (message.type === "providerDisconnected") {
      item.onDisconnected?.(message)
      return
    }

    if (message.type === "providerActionError") {
      item.onError?.(message)
    }
  })

  function send(message: ProviderRequestInput, handlers: Handlers = {}) {
    const requestId = crypto.randomUUID()
    const timer = handlers.timeout ? setTimeout(() => take(requestId)?.onTimeout?.(), handlers.timeout) : undefined
    pending.set(requestId, { ...handlers, timer })
    vscode.postMessage({ ...message, requestId } as ProviderRequest)
    return requestId
  }

  function clear(requestId?: string) {
    if (requestId) {
      take(requestId)
      return
    }
    for (const id of [...pending.keys()]) take(id)
  }

  function dispose() {
    clear()
    unsubscribe()
  }

  return { clear, send, dispose }
}
