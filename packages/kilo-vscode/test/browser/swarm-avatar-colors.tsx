import "@kilocode/kilo-ui/styles"
import { OpenCode, type SessionMessageAssistantTool, type SessionMessageInfo } from "@opencode/client"
import { onMount } from "solid-js"
import { render } from "solid-js/web"
import { SubagentPanel } from "../../webview-ui/agent-manager/SubagentPanel"
import { SpeechToTextStatusProvider } from "../../webview-ui/src/components/speech-to-text/status"
import { V2Scope } from "../../webview-ui/src/v2/client"
import { events } from "../../webview-ui/src/v2/events"
import { createV2Scope } from "../../webview-ui/src/v2/scope"
import { SessionView } from "../../webview-ui/src/v2/session-view"
import { WebviewShell } from "../../webview-ui/src/v2/shell"
import "../../webview-ui/src/styles/chat.css"

const parent = "ses_parent"
const directory = "/fixture"
// These siblings hash to the same hue; the transcript's palette assigns the second a different one.
const children = ["ses_b", "ses_e"].map((id, index) => ({ id, title: `Agent ${index + 1}` }))
const board = {
  ownerSessionID: parent,
  revision: 1,
  hasMore: false,
  messages: children.map((child) => ({
    id: `post_${child.id}`,
    timestamp: 1,
    from: child.id,
    fromLabel: child.title,
    to: "main",
    type: "INFO",
    body: `${child.title} reporting in`,
  })),
}
const subagent = (id: string, title: string, name = "subagent"): SessionMessageAssistantTool => ({
  type: "tool",
  id: `call_${id}`,
  name,
  time: { created: 1 },
  state: {
    status: "completed",
    input: { background: true, description: title },
    metadata: { sessionID: id, status: "running" },
    content: [{ type: "text", text: "Started in the background" }],
  },
})
const messages: SessionMessageInfo[] = [
  {
    id: "msg_assistant",
    type: "assistant",
    agent: "code",
    model: { providerID: "fixture", id: "model" },
    time: { created: 1 },
    content: [
      // Imported task rows are visible in the inspector but must not shift the native subagent colors.
      subagent("ses_k", "Imported task", "task"),
      ...children.map((child) => subagent(child.id, child.title)),
      {
        type: "tool",
        id: "call_board",
        name: "board_read",
        time: { created: 1 },
        state: {
          status: "completed",
          input: {},
          metadata: {},
          content: [{ type: "text", text: JSON.stringify(board) }],
        },
      },
    ],
  },
  { id: "msg_user", type: "user", text: "Start two background agents", time: { created: 0 } },
]

function Fixture() {
  const event = events()
  const api = OpenCode.make({
    baseUrl: location.origin,
    fetch: async (input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === `/api/session/${parent}/message`) return Response.json({ data: messages, cursor: {} })
      if (path === "/api/rpc/kilocode.board/status") return Response.json({ output: { enabled: true } })
      if (path === "/api/rpc/kilocode.board/get") return Response.json({ output: board })
      if (path === "/api/rpc/kilocode.sandbox/support")
        return Response.json({ output: { available: true, enabled: false, network: false } })
      if (path === "/api/rpc/kilocode.sandbox/status")
        return Response.json({ output: { directory, enabled: false, available: true, network: false, version: 1 } })
      return new Response(null, { status: 404 })
    },
  })
  const scope = createV2Scope({
    api,
    connection: {
      status: () => "connecting",
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
    for (const id of [parent, ...children.map((child) => child.id)]) {
      event.emit({
        id: `event_${id}`,
        type: "session.execution.started",
        created: 1,
        durable: { aggregateID: id, seq: 1, version: 1 },
        data: { sessionID: id },
      })
    }
    scope.data.session.remember({
      id: parent,
      projectID: "fixture",
      location: { directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 0, updated: 1 },
    })
    void scope.data.session.message.sync(parent)
    event.emit({ id: "event_config", type: "config.updated", created: 1, data: {} })
  })

  return (
    <V2Scope value={scope}>
      <SpeechToTextStatusProvider>
        <SessionView session={parent} onSession={() => {}} actions={{}} onShowHistory={() => {}} />
        <SubagentPanel
          sessions={{
            activityFor: () => "busy",
            currentSessionID: () => parent,
            messages: scope.data.session.message.list,
            release: () => {},
            scope: () => undefined,
          }}
          tabs={() => [...children.toReversed(), { id: "ses_k", title: "Imported task" }]}
          active={() => undefined}
          visible={() => true}
          nextKeybind=""
          closeKeybind=""
          actions={{}}
          onSelect={() => {}}
          onClose={() => {}}
          onCloseOthers={() => {}}
          onReorder={() => {}}
          onClosePanel={() => {}}
          onShowHistory={() => {}}
        />
      </SpeechToTextStatusProvider>
    </V2Scope>
  )
}

Object.assign(window, {
  acquireVsCodeApi: () => ({ postMessage: () => {}, getState: () => undefined, setState: () => {} }),
})
render(
  () => (
    <WebviewShell>
      <Fixture />
    </WebviewShell>
  ),
  document.body,
)
