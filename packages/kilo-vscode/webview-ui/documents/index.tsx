import { onCleanup, onMount, type Component, createSignal } from "solid-js"
import { render } from "solid-js/web"
import "@kilocode/kilo-ui/styles"
import "../src/styles/chat.css"
import "../agent-manager/agent-manager.css"
import "../agent-manager/agent-manager-review.css"
import { ProviderShell } from "../src/context/provider-shell"
import { useVSCode } from "../src/context/vscode"
import { DocumentPanel } from "./DocumentPanel"
import { createDocumentComments, createDocuments, type DocumentMessage } from "./state"

const App: Component = () => {
  const vscode = useVSCode()
  const [scope, setScope] = createSignal<string | null>(null)
  const [session, setSession] = createSignal<string | null>(null)
  const docs = createDocuments(vscode, scope, session, (id, file, contextKey) =>
    vscode.postMessage({ type: "document.request", sessionId: id, file, contextKey }),
  )
  const comments = createDocumentComments(scope)
  const [visible, setVisible] = createSignal(true)

  const open = (message: { sessionId?: string; contextKey: string; file: string; line?: number; column?: number }) => {
    setScope(message.contextKey)
    setSession(message.sessionId ?? null)
    docs.open(message.file, message.sessionId ?? "", message.line, message.column)
    setVisible(true)
  }

  onMount(() => {
    const message = vscode.onMessage((item) => {
      if (item.type === "document.open") {
        open(item)
        return
      }
      if (item.type === "document.result") docs.onMessage(item as DocumentMessage)
    })
    const review = (event: MessageEvent) => {
      if (event.data?.type !== "appendReviewComments" || !Array.isArray(event.data.comments)) return
      vscode.postMessage({
        type: "document.sendComments",
        comments: event.data.comments,
        autoSend: !!event.data.autoSend,
      })
    }
    window.addEventListener("message", review)
    onCleanup(() => {
      message()
      window.removeEventListener("message", review)
    })
  })

  return (
    <DocumentPanel
      tabs={docs.tabs}
      active={docs.active}
      getData={docs.document}
      comments={comments.comments()}
      onCommentsChange={comments.setComments}
      onSelect={docs.select}
      onClose={docs.close}
      onCloseOthers={docs.closeOthers}
      onReorder={docs.reorder}
      onOpenFile={(file, line, column) => vscode.postMessage({ type: "document.openFile", file, line, column })}
      onClosePanel={() => {
        setVisible(false)
        vscode.postMessage({ type: "document.close" })
      }}
      visible={visible}
    />
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")
render(
  () => (
    <ProviderShell.Root>
      <App />
    </ProviderShell.Root>
  ),
  root,
)
