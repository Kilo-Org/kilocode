// Messages between the webview and the extension host. The webview has no server credentials: it sends HTTP
// requests through the host (`fetch`), and the host streams each response back in order.

export type Request = {
  type: "fetch"
  id: number
  /** Path and query, for example `/api/session?limit=50`. */
  path: string
  method: string
  headers: [string, string][]
  body?: string
}

export type ToHost = Request | { type: "abort"; id: number } | { type: "open"; url: string } | Ui

/** Messages of the copied v1 UI. The host ignores `webviewFocusChanged` and `setLanguage` for now. */
export type Ui =
  | { type: "copyToClipboard"; id: string; text: string }
  | { type: "requestModelSelectorExpanded" }
  | { type: "persistModelSelectorExpanded"; value: boolean }
  | { type: "webviewFocusChanged"; focused: boolean }
  | { type: "setLanguage"; locale: string }
  | { type: "saveImage"; dataUrl: string; filename: string }
  | { type: "openProfile" }

export type ToWebview =
  | { type: "response"; id: number; status: number; statusText: string; headers: [string, string][] }
  | { type: "chunk"; id: number; data: Uint8Array }
  | { type: "end"; id: number }
  | { type: "error"; id: number; message: string }
  | { type: "command"; name: "newSession" | "history" | "profile" | "cycleAgentMode" | "cyclePreviousAgentMode" }
  | { type: "keybindings"; bindings: Record<string, string> }
  | { type: "clipboardWriteResult"; id: string; ok: boolean; error?: string }
  | { type: "modelSelectorExpandedLoaded"; value: boolean }
  | { type: "webviewActiveChanged"; active: boolean }
