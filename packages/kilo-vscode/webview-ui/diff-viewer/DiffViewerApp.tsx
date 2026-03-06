// Diff Viewer root component
// Minimal wrapper around the Agent Manager's FullScreenDiffView.
// Communicates with the DiffViewerProvider via postMessage.

import { Component, createSignal, createMemo, onCleanup } from "solid-js"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { I18nProvider } from "@kilocode/kilo-ui/context"
import type { UiI18nKey, UiI18nParams } from "@kilocode/kilo-ui/context"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Toast } from "@kilocode/kilo-ui/toast"
import { dict as uiEn } from "@kilocode/kilo-ui/i18n/en"
import { dict as appEn } from "../src/i18n/en"
import { dict as amEn } from "../agent-manager/i18n/en"
import { dict as kiloEn } from "@kilocode/kilo-i18n/en"
import { LanguageContext } from "../src/context/language"
import { FullScreenDiffView } from "../agent-manager/FullScreenDiffView"
import type { WorktreeFileDiff, ReviewComment } from "../src/types/messages"

type DiffStyle = "unified" | "split"

// acquireVsCodeApi must be called exactly once at module scope
const vscodeApi = acquireVsCodeApi()

// Standalone English dict (covers all keys used by FullScreenDiffView)
const dict = { ...appEn, ...uiEn, ...kiloEn, ...amEn }

function resolveTemplate(text: string, params?: Record<string, string | number | boolean | undefined>) {
  if (!params) return text
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = params[key]
    return val !== undefined ? String(val) : `{{${key}}}`
  })
}

const DiffViewerContent: Component = () => {
  const [diffs, setDiffs] = createSignal<WorktreeFileDiff[]>([])
  const [loading, setLoading] = createSignal(true)
  const [comments, setComments] = createSignal<ReviewComment[]>([])
  const [diffStyle, setDiffStyle] = createSignal<DiffStyle>("unified")

  // Register the message listener immediately (not in onMount) so we
  // never miss the initial data push from the extension.
  const handler = (event: MessageEvent) => {
    const msg = event.data
    if (!msg || !msg.type) return

    if (msg.type === "diffViewer.diffs" && Array.isArray(msg.diffs)) {
      setDiffs(msg.diffs)
      return
    }

    if (msg.type === "diffViewer.loading" && typeof msg.loading === "boolean") {
      setLoading(msg.loading)
      return
    }

    // Intercept the appendReviewComments window event dispatched by
    // FullScreenDiffView and review-annotations.ts, and forward it
    // to the extension which routes it to the sidebar chat input.
    if (msg.type === "appendReviewComments" && Array.isArray(msg.comments)) {
      vscodeApi.postMessage({ type: "diffViewer.sendComments", comments: msg.comments })
      return
    }
  }

  window.addEventListener("message", handler)
  onCleanup(() => window.removeEventListener("message", handler))

  // Signal readiness so the extension starts diff polling
  vscodeApi.postMessage({ type: "webviewReady" })

  return (
    <FullScreenDiffView
      diffs={diffs()}
      loading={loading()}
      sessionKey="local"
      comments={comments()}
      onCommentsChange={setComments}
      onSendAll={() => {
        // FullScreenDiffView dispatches appendReviewComments via window event
        // before calling this callback. The handler above forwards them to
        // the extension. Nothing extra needed here.
      }}
      diffStyle={diffStyle()}
      onDiffStyleChange={(style) => {
        setDiffStyle(style)
        vscodeApi.postMessage({ type: "diffViewer.setDiffStyle", style })
      }}
      onOpenFile={(relativePath) => {
        vscodeApi.postMessage({ type: "openFile", filePath: relativePath })
      }}
      onClose={() => {
        vscodeApi.postMessage({ type: "diffViewer.close" })
      }}
    />
  )
}

export const DiffViewerApp: Component = () => {
  const locale = createMemo(() => "en" as const)

  const t = (key: UiI18nKey, params?: UiI18nParams) => {
    const text = (dict as Record<string, string>)[key] ?? String(key)
    return resolveTemplate(text, params as Record<string, string | number | boolean | undefined>)
  }

  return (
    <ThemeProvider defaultTheme="kilo-vscode">
      <DialogProvider>
        <LanguageContext.Provider
          value={{
            locale,
            setLocale: () => {},
            userOverride: () => "",
            t: t as (key: string, params?: UiI18nParams) => string,
          }}
        >
          <I18nProvider value={{ locale: () => locale(), t }}>
            <DiffComponentProvider component={Diff}>
              <CodeComponentProvider component={Code}>
                <MarkedProvider>
                  <DiffViewerContent />
                </MarkedProvider>
              </CodeComponentProvider>
            </DiffComponentProvider>
          </I18nProvider>
        </LanguageContext.Provider>
      </DialogProvider>
      <Toast.Region />
    </ThemeProvider>
  )
}
