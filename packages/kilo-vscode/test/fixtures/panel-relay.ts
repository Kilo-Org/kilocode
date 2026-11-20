import { bridge, type Target } from "../../src/relay"
import type { InMessage, VSCodeContext } from "../../webview-ui/agent-manager/v2/bridge"

export function panelRelay(target: Target, serve: (request: Request) => Promise<Response>) {
  const listeners = new Set<(message: InMessage) => void>()
  const relay = bridge({
    target: async () => target,
    post: (message) => listeners.forEach((listener) => listener(message)),
    fetch: Object.assign((input: Parameters<typeof fetch>[0], init?: RequestInit) => serve(new Request(input, init)), {
      preconnect: fetch.preconnect,
    }),
  })
  const vscode: VSCodeContext = {
    postMessage: (message) => {
      if (message.type === "fetch" || message.type === "abort") relay.receive(message)
    },
    onMessage: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getState: () => undefined,
    setState: () => {},
    sidebarSide: () => undefined,
    active: () => true,
    getModelSelectorExpanded: () => false,
    setModelSelectorExpanded: () => {},
  }
  return { vscode, dispose: relay.dispose }
}
