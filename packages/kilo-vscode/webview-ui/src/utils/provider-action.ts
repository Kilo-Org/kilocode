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
}

export function createProviderAction(vscode: Transport) {
  const pending = new Map<string, Handlers>()
  const unsubscribe = vscode.onMessage((message) => {
    if (!("requestId" in message)) return

    const item = pending.get(message.requestId)
    if (!item) return
    pending.delete(message.requestId)

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
    pending.set(requestId, handlers)
    vscode.postMessage({ ...message, requestId } as ProviderRequest)
    return requestId
  }

  function clear(requestId?: string) {
    if (requestId) {
      pending.delete(requestId)
      return
    }
    pending.clear()
  }

  function dispose() {
    clear()
    unsubscribe()
  }

  return {
    clear,
    send,
    dispose,
  }
}
