import { createSignal, onCleanup, onMount, type Component } from "solid-js"
import { render } from "solid-js/web"
import "@kilocode/kilo-ui/styles"
import "../src/styles/chat.css"
import "../agent-manager/agent-manager.css"
import "../agent-manager/agent-manager-review.css"
import { useVSCode } from "../src/context/vscode"
import { WebviewShell } from "../src/v2/shell"
import { APPEND_REVIEW_COMMENTS, type AppendReviewCommentsDetail } from "../diff-viewer/review-annotations"
import { DocumentPanel } from "./DocumentPanel"
import { createDocumentComments, createDocuments, type DocumentMessage } from "./state"

interface OpenMessage {
  type: "document.open"
  sessionId?: string
  contextKey: string
  file: string
  line?: number
  column?: number
}

const App: Component = () => {
  const vscode = useVSCode()
  const [scope, setScope] = createSignal<string | null>(null)
  const [session, setSession] = createSignal<string | null>(null)
  const docs = createDocuments(scope, session, (id, file, contextKey) =>
    vscode.postMessage({ type: "document.request", sessionId: id, file, contextKey } as never),
  )
  const comments = createDocumentComments(scope)
  const [visible, setVisible] = createSignal(true)

  const open = (message: OpenMessage) => {
    setScope(message.contextKey)
    setSession(message.sessionId ?? null)
    docs.open(message.file, message.sessionId ?? "", message.line, message.column)
    setVisible(true)
  }

  onMount(() => {
    vscode.postMessage({ type: "webviewReady" } as never)
    const message = vscode.onMessage((item) => {
      const incoming = item as unknown as { type?: string }
      if (incoming.type === "document.open") {
        open(item as unknown as OpenMessage)
        return
      }
      if (incoming.type === "document.result") docs.onMessage(item as unknown as DocumentMessage)
    })
    const review = (event: Event) => {
      const detail = (event as CustomEvent<AppendReviewCommentsDetail>).detail
      if (!detail || detail.handled) return
      detail.handled = true
      vscode.postMessage({
        type: "document.sendComments",
        comments: detail.comments,
        autoSend: detail.autoSend,
      } as never)
    }
    window.addEventListener(APPEND_REVIEW_COMMENTS, review)
    onCleanup(() => {
      message()
      window.removeEventListener(APPEND_REVIEW_COMMENTS, review)
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
      onOpenFile={(file, line, column) =>
        vscode.postMessage({ type: "document.openFile", file, line, column } as never)
      }
      onCopyPath={(file) => vscode.postMessage({ type: "document.copyPath", file } as never)}
      onClosePanel={() => {
        setVisible(false)
        vscode.postMessage({ type: "document.close" } as never)
      }}
      visible={visible}
    />
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")
render(
  () => (
    <WebviewShell>
      <App />
    </WebviewShell>
  ),
  root,
)
