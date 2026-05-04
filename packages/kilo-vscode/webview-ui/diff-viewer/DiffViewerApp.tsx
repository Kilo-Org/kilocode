import { createEffect, createSignal, on, onCleanup, Show } from "solid-js"
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
import type { ReviewComment, WorktreeFileDiff } from "../src/types/messages"
import type { DiffSourceCapabilities, DiffSourceDescriptor } from "../src/types/messages/extension-messages"
import { DiffPickerHeader } from "./DiffPickerHeader"

type DiffStyle = "unified" | "split"

const post = (message: Record<string, unknown>) => getVSCodeAPI().postMessage(message as never)

const DiffViewerContent: Component = () => {
  const vscode = useVSCode()
  const [diffs, setDiffs] = createSignal<WorktreeFileDiff[]>([])
  const [loading, setLoading] = createSignal(true)
  const [comments, setComments] = createSignal<ReviewComment[]>([])
  const [diffStyle, setDiffStyle] = createSignal<DiffStyle>("unified")
  const [reverting, setReverting] = createSignal<Set<string>>(new Set())
  const [availableSources, setAvailableSources] = createSignal<DiffSourceDescriptor[]>([])
  const [currentSourceId, setCurrentSourceId] = createSignal<string | undefined>(undefined)
  const [capabilities, setCapabilities] = createSignal<DiffSourceCapabilities | undefined>(undefined)

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

    if (msg.type === "setAvailableSources") {
      setAvailableSources(msg.descriptors)
      setCurrentSourceId(msg.currentId)
      return
    }

    if (msg.type === "diffViewer.capabilities") {
      setCapabilities(msg.capabilities)
      return
    }
  })

  const selectSource = (id: string) => {
    if (id === currentSourceId()) return
    post({ type: "selectSource", id })
  }

  // Reset transient UI state when the active source changes. Comments are
  // discarded without confirmation; diff style goes back to
  // unified; in-flight revert indicators are cleared. The diffs list itself
  // is reset by the extension sending `diffs: []` before the new fetch.
  createEffect(
    on(currentSourceId, (id, prev) => {
      if (prev === undefined || id === prev) return
      setComments([])
      setDiffStyle("unified")
      setReverting(new Set())
    }),
  )

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
    <>
      <Show when={availableSources().length > 0}>
        <DiffPickerHeader descriptors={availableSources()} currentId={currentSourceId()} onSelect={selectSource} />
      </Show>
      <FullScreenDiffView
        diffs={diffs()}
        loading={loading()}
        sessionKey={currentSourceId() ?? "local"}
        comments={comments()}
        onCommentsChange={setComments}
        onSendAll={() => {}}
        diffStyle={diffStyle()}
        onDiffStyleChange={(style) => {
          setDiffStyle(style)
          post({ type: "diffViewer.setDiffStyle", style })
        }}
        onOpenFile={(relativePath) => {
          post({ type: "openFile", filePath: relativePath })
        }}
        onRevertFile={(file) => {
          markReverting(file, true)
          post({ type: "diffViewer.revertFile", file })
        }}
        revertingFiles={reverting()}
        canRevert={capabilities()?.revert ?? true}
        canComment={capabilities()?.comments ?? true}
        onClose={() => {
          post({ type: "diffViewer.close" })
        }}
      />
    </>
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
