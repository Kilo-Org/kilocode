import { createSignal, onCleanup } from "solid-js"
import type { Component } from "solid-js"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { FileComponentProvider } from "@kilocode/kilo-ui/context/file"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { File } from "@kilocode/kilo-ui/file"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { Toast } from "@kilocode/kilo-ui/toast"
import { FullScreenDiffView } from "../agent-manager/FullScreenDiffView"
import { LanguageProvider } from "../src/context/language"
import { ServerProvider, useServer } from "../src/context/server"
import { getVSCodeAPI, VSCodeProvider, useVSCode } from "../src/context/vscode"
import type { ReviewComment, WebviewMessage, WorktreeFileDiff } from "../src/types/messages"

type DiffStyle = "unified" | "split"

const post = (message: WebviewMessage) => getVSCodeAPI().postMessage(message)

const DiffViewerContent: Component = () => {
  const vscode = useVSCode()
  const [diffs, setDiffs] = createSignal<WorktreeFileDiff[]>([])
  const [loading, setLoading] = createSignal(true)
  const [comments, setComments] = createSignal<ReviewComment[]>([])
  const [diffStyle, setDiffStyle] = createSignal<DiffStyle>("unified")
  const [markdown, setMarkdown] = createSignal(false)
  const [reverting, setReverting] = createSignal<Set<string>>(new Set())

  const markReverting = (file: string, active: boolean) => {
    setReverting((prev) => {
      const next = new Set(prev)
      if (active) next.add(file)
      else next.delete(file)
      return next
    })
  }

  const unsubscribe = vscode.onMessage((msg) => {
    if (msg.type === "diffViewer.diffs") {
      setDiffs(msg.diffs)
      return
    }

    if (msg.type === "diffViewer.loading") {
      setLoading(msg.loading)
      return
    }

    if (msg.type === "diffViewer.revertFileResult") {
      markReverting(msg.file, false)
      return
    }

    if (msg.type === "diffViewer.markdownRender") {
      setMarkdown(msg.render)
      return
    }
  })

  const handler = (event: MessageEvent) => {
    const msg = event.data
    if (msg?.type !== "appendReviewComments" || !Array.isArray(msg.comments)) return
    post({ type: "diffViewer.sendComments", comments: msg.comments, autoSend: !!msg.autoSend })
  }

  window.addEventListener("message", handler)
  onCleanup(() => {
    unsubscribe()
    window.removeEventListener("message", handler)
  })

  return (
    <FullScreenDiffView
      diffs={diffs()}
      loading={loading()}
      sessionKey="local"
      comments={comments()}
      onCommentsChange={setComments}
      onSendAll={() => {}}
      diffStyle={diffStyle()}
      onDiffStyleChange={(style) => {
        setDiffStyle(style)
        post({ type: "diffViewer.setDiffStyle", style })
      }}
      markdownRender={markdown()}
      onMarkdownRenderChange={(render) => {
        setMarkdown(render)
        post({ type: "diffViewer.setMarkdownRender", render })
      }}
      onOpenFile={(relativePath) => {
        post({ type: "openFile", filePath: relativePath })
      }}
      onRevertFile={(file) => {
        markReverting(file, true)
        post({ type: "diffViewer.revertFile", file })
      }}
      revertingFiles={reverting()}
      onClose={() => {
        post({ type: "diffViewer.close" })
      }}
    />
  )
}

const DiffViewerShell: Component = () => {
  const server = useServer()

  return (
    <LanguageProvider vscodeLanguage={server.vscodeLanguage} languageOverride={server.languageOverride}>
      <DiffComponentProvider component={Diff}>
        <CodeComponentProvider component={Code}>
          <FileComponentProvider component={File}>
            <MarkedProvider>
              <DiffViewerContent />
            </MarkedProvider>
          </FileComponentProvider>
        </CodeComponentProvider>
      </DiffComponentProvider>
    </LanguageProvider>
  )
}

export const DiffViewerApp: Component = () => {
  return (
    <ThemeProvider defaultTheme="kilo-vscode">
      <DialogProvider>
        <VSCodeProvider>
          <ServerProvider>
            <DiffViewerShell />
          </ServerProvider>
        </VSCodeProvider>
      </DialogProvider>
      <Toast.Region />
    </ThemeProvider>
  )
}
