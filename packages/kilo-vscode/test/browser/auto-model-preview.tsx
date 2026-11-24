/** @jsxImportSource solid-js */
import "@kilocode/kilo-ui/styles"
import { OpenCode, type AgentInfo, type ModelInfo, type ProviderInfo } from "@opencode/client"
import { onMount } from "solid-js"
import { render } from "solid-js/web"
import { SpeechToTextStatusProvider } from "../../webview-ui/src/components/speech-to-text/status"
import { V2Scope } from "../../webview-ui/src/v2/client"
import { events } from "../../webview-ui/src/v2/events"
import { createV2Scope } from "../../webview-ui/src/v2/scope"
import { SessionView } from "../../webview-ui/src/v2/session-view"
import { WebviewShell } from "../../webview-ui/src/v2/shell"
import "../../webview-ui/src/styles/chat.css"

const params = new URLSearchParams(location.search)
const theme = params.get("theme") === "light" ? "light" : "dark"
const modelParam = params.get("model")
const initialModel =
  modelParam === "explicit"
    ? "kilo/anthropic/claude-opus-4.6"
    : modelParam === "frontier"
      ? "kilo/kilo-auto/frontier"
      : "kilo/kilo-auto/efficient"

const DARK_TOKENS: Record<string, string> = {
  "font-family": '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  "font-size": "13px",
  "editor-font-family": 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  "editor-background": "#1f1f1f",
  "editor-foreground": "#cccccc",
  foreground: "#cccccc",
  descriptionForeground: "#9d9d9d",
  disabledForeground: "rgba(204, 204, 204, 0.5)",
  "icon-foreground": "#cccccc",
  focusBorder: "#3794ff",
  "textLink-foreground": "#3794ff",
  "editorWidget-background": "#252526",
  "widget-border": "#3c3c3c",
  "panel-border": "#323232",
  "sideBar-background": "#181818",
  "input-background": "#2b2b2b",
  "input-foreground": "#e4e4e4",
  "input-placeholderForeground": "#8b8b8b",
  "input-border": "#3c3c3c",
  "editorWarning-foreground": "#e5a93c",
  "testing-iconPassed": "#3fb950",
  "button-background": "#0e639c",
  "button-foreground": "#ffffff",
}

const LIGHT_TOKENS: Record<string, string> = {
  "font-family": '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  "font-size": "13px",
  "editor-font-family": 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  "editor-background": "#ffffff",
  "editor-foreground": "#1f1f1f",
  foreground: "#1f1f1f",
  descriptionForeground: "#5f5f5f",
  disabledForeground: "rgba(31, 31, 31, 0.45)",
  "icon-foreground": "#424242",
  focusBorder: "#005fb8",
  "textLink-foreground": "#005fb8",
  "editorWidget-background": "#f8f8f8",
  "widget-border": "#d4d4d4",
  "panel-border": "#e5e5e5",
  "sideBar-background": "#f3f3f3",
  "input-background": "#ffffff",
  "input-foreground": "#1f1f1f",
  "input-placeholderForeground": "#767676",
  "input-border": "#cecece",
  "editorWarning-foreground": "#9a6700",
  "testing-iconPassed": "#1a7f37",
  "button-background": "#005fb8",
  "button-foreground": "#ffffff",
}

const tokens = theme === "light" ? LIGHT_TOKENS : DARK_TOKENS
document.body.classList.add(theme === "light" ? "vscode-light" : "vscode-dark")
for (const [token, value] of Object.entries(tokens)) {
  document.documentElement.style.setProperty(`--vscode-${token}`, value)
}

const directory = "/fixture"

const agents: AgentInfo[] = [
  {
    id: "code",
    name: "Code",
    request: { settings: {}, headers: {}, body: {} },
    mode: "primary",
    hidden: false,
    permissions: [],
  },
  {
    id: "ask",
    name: "Ask",
    request: { settings: {}, headers: {}, body: {} },
    mode: "primary",
    hidden: false,
    permissions: [],
  },
]

const providers: ProviderInfo[] = [
  {
    id: "kilo",
    name: "Kilo Gateway",
    source: "builtin",
    env: [],
    request: { settings: {}, headers: {}, body: {} },
  },
]

function makeModel(id: string, name: string, input: number, output: number): ModelInfo {
  return {
    id,
    modelID: id,
    providerID: "kilo",
    name,
    enabled: true,
    time: { released: 1_767_225_600_000 },
    cost: [{ input, output, cache: { read: 0, write: 0 } }],
    limit: { context: 200_000, output: 16_384 },
    status: "active",
    capabilities: {
      tools: true,
      temperature: true,
      input: ["text", "image"],
      output: ["text"],
    },
    variants: [],
  }
}

const models: ModelInfo[] = [
  makeModel("kilo-auto/efficient", "Auto Efficient", 0, 0),
  makeModel("kilo-auto/frontier", "Auto Frontier", 0, 0),
  makeModel("anthropic/claude-opus-4.6", "Claude Opus 4.6", 15, 75),
  makeModel("anthropic/claude-sonnet-4.6", "Claude Sonnet 4.6", 3, 15),
  makeModel("google/gemini-2.5-flash", "Gemini Flash", 0.3, 2.5),
]

function Fixture() {
  const event = events()
  const api = OpenCode.make({
    baseUrl: location.origin,
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const pathname = url.pathname
      if (pathname === "/api/agent") return Response.json({ location: { directory }, data: agents })
      if (pathname === "/api/provider") return Response.json({ location: { directory }, data: providers })
      if (pathname === "/api/model") return Response.json({ location: { directory }, data: models })
      if (pathname === "/api/model/default") {
        const picked = models.find((item) => `${item.providerID}/${item.id}` === initialModel) ?? models[0]
        return Response.json({ location: { directory }, data: picked })
      }
      if (pathname === "/api/config") return Response.json([{ type: "document", info: { model: initialModel } }])
      if (pathname === "/api/plugin") return Response.json({ location: { directory }, data: [{ id: "kilo.gateway" }] })
      if (pathname === "/api/info") return Response.json({ version: "2.0.0", revision: "fixture" })
      if (pathname === "/api/event")
        return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } })
      if (pathname === "/api/rpc/kilocode.handshake/get")
        return Response.json({ output: { product: "kilo", version: "2.0.0", channel: "dev" } })
      if (pathname === "/api/rpc/kilocode.gateway/authStatus")
        return Response.json({ output: { authenticated: true, organizationID: null, server: "https://api.kilo.ai" } })
      if (pathname === "/api/rpc/kilocode.gateway/catalog.status")
        return Response.json({ output: { failure: null } })
      if (pathname === "/api/rpc/kilocode.gateway/models") {
        return Response.json({
          output: models.map((item) => ({ id: item.id, name: item.name, isFree: false })),
        })
      }
      if (pathname === "/api/rpc/kilocode.gateway/autoModel.preview") {
        return fetch(input, init)
      }
      if (pathname === "/api/session") return Response.json({ data: [], cursor: {} })
      if (pathname === "/api/rpc/kilocode.sandbox/support")
        return Response.json({ output: { available: false, enabled: false, network: false } })
      return Response.json({ location: { directory }, data: [] })
    },
  })

  const scope = createV2Scope({
    api,
    connection: {
      status: () => "connected",
      attempt: () => 0,
      error: () => undefined,
      internal: { history: () => [], resync: () => {} },
    },
    event,
    directory,
    bindings: () => ({}),
    selection: () => false,
    onCommand: () => {},
    open: () => {},
  })

  onMount(() => {
    void scope.data.location.agent.sync()
    void scope.data.location.provider.sync()
    void scope.data.location.model.sync()
    void scope.data.location.config.sync()
  })

  return (
    <V2Scope value={scope}>
      <SpeechToTextStatusProvider>
        <div class="chat-panel-shell">
          <SessionView
            session={undefined}
            draftKey="auto-model-preview-fixture"
            onSession={() => {}}
            actions={{}}
            onShowHistory={() => {}}
          />
        </div>
      </SpeechToTextStatusProvider>
    </V2Scope>
  )
}

Object.assign(window, {
  ICONS_BASE_URI: `${location.origin}/icons`,
  acquireVsCodeApi: () => ({
    postMessage: (message: { type?: string }) => {
      if (message?.type === "requestModelPreferences") {
        queueMicrotask(() =>
          window.postMessage(
            { type: "modelPreferencesLoaded", value: { favorites: [], recents: [], usage: {}, variants: {} } },
            location.origin,
          ),
        )
      }
    },
    getState: () => undefined,
    setState: () => {},
  }),
})

render(
  () => (
    <WebviewShell>
      <Fixture />
    </WebviewShell>
  ),
  document.body,
)
