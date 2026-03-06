import { createMemo, createSignal, onCleanup } from "solid-js"
import type { Component } from "solid-js"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { I18nProvider } from "@kilocode/kilo-ui/context"
import type { UiI18nKey, UiI18nParams } from "@kilocode/kilo-ui/context"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { Toast } from "@kilocode/kilo-ui/toast"
import { dict as kiloEn } from "@kilocode/kilo-i18n/en"
import { dict as uiEn } from "@kilocode/kilo-ui/i18n/en"
import { FullScreenDiffView } from "../agent-manager/FullScreenDiffView"
import { LanguageContext } from "../src/context/language"
import { dict as amEn } from "../agent-manager/i18n/en"
import { dict as appEn } from "../src/i18n/en"
import type { ReviewComment, WorktreeFileDiff } from "../src/types/messages"

type DiffStyle = "unified" | "split"

const vscodeApi = acquireVsCodeApi()
const dict = { ...appEn, ...uiEn, ...kiloEn, ...amEn }
const post = (message: Record<string, unknown>) => vscodeApi.postMessage(message as never)

function resolveTemplate(text: string, params?: Record<string, string | number | boolean | undefined>) {
  if (!params) return text
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = params[key]
    return value !== undefined ? String(value) : `{{${key}}}`
  })
}

const DiffViewerContent: Component = () => {
  const [diffs, setDiffs] = createSignal<WorktreeFileDiff[]>([])
  const [loading, setLoading] = createSignal(true)
  const [comments, setComments] = createSignal<ReviewComment[]>([])
  const [diffStyle, setDiffStyle] = createSignal<DiffStyle>("unified")

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

    if (msg.type === "appendReviewComments" && Array.isArray(msg.comments)) {
      post({ type: "diffViewer.sendComments", comments: msg.comments })
    }
  }

  window.addEventListener("message", handler)
  onCleanup(() => window.removeEventListener("message", handler))

  post({ type: "webviewReady" })

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
      onOpenFile={(relativePath) => {
        post({ type: "openFile", filePath: relativePath })
      }}
      onClose={() => {
        post({ type: "diffViewer.close" })
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
