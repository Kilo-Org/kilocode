import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import { Button } from "@kilocode/kilo-ui/button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { applyKiloTheme, applyVscodeTheme } from "../../../kilo-ui/src/stories/theme-decorator"
import { AnnotationEditorHost } from "../../webview-ui/src/components/chat/AnnotationPopover"
import { AnnotationList } from "../../webview-ui/src/components/chat/AnnotationList"
import { ResponseLens } from "../../webview-ui/src/components/chat/ResponseLens"
import { ConfigProvider } from "../../webview-ui/src/context/config"
import { LanguageContext } from "../../webview-ui/src/context/language"
import { ProviderContext } from "../../webview-ui/src/context/provider"
import { SessionContext } from "../../webview-ui/src/context/session"
import { VSCodeProvider } from "../../webview-ui/src/context/vscode"
import { dict } from "../../webview-ui/src/i18n/en"
import type { WebviewMessage } from "../../webview-ui/src/types/messages"
import {
  annotationFocusTarget,
  commitAnnotationEditor,
  openAnnotationEditor,
  updateAnnotationEditor,
  type AnnotationEditorState,
} from "../../webview-ui/src/utils/annotation-state"
import { newAnnotation, type Annotation } from "../../webview-ui/src/utils/annotations"
import { post } from "../../webview-ui/src/utils/webview-message"
import "@kilocode/kilo-ui/styles"
import "../../webview-ui/src/styles/chat.css"

const theme = new URLSearchParams(location.search).get("theme") ?? "dark-modern"
applyKiloTheme("kilo-vscode", applyVscodeTheme(theme))
Object.assign(window, {
  acquireVsCodeApi: () => ({
    getState: () => undefined,
    setState: () => {},
    postMessage: (message: WebviewMessage) => {
      if (message.type !== "explainBriefly") return
      queueMicrotask(() =>
        post({
          type: "explainBrieflyResult",
          requestId: message.requestId,
          text: "Precision tells you how many of the model's positive predictions were correct. Higher precision means fewer false alarms.",
          model: message.model,
          truncated: false,
        }),
      )
    },
  }),
})

const language = {
  language: () => "en",
  setLanguage: () => {},
  t: (key: string, values?: Record<string, string | number>) =>
    ((dict as Record<string, string>)[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) =>
      String(values?.[name] ?? name),
    ),
}
const model = { id: "fixture", name: "Fixture model", providerID: "test", providerName: "Test" }
const text = "Precision measures correct positive predictions. Recall measures how many true positives were found."

function Fixture() {
  const [annotations, setAnnotations] = createSignal<Annotation[]>([
    {
      ...newAnnotation({
        sessionID: "visual",
        messageID: "answer",
        selectedText: "Recall",
        comment: "Keep this saved note",
      }),
      number: 7,
    },
  ])
  const [editor, setEditor] = createSignal<AnnotationEditorState>()
  let transcript!: HTMLDivElement
  let prompt!: HTMLInputElement | HTMLTextAreaElement
  let primary: HTMLElement | undefined
  let fallback: HTMLElement | undefined
  const close = (focus: boolean) => {
    setEditor(undefined)
    if (focus) requestAnimationFrame(() => (annotationFocusTarget(primary, fallback) ?? prompt).focus())
  }
  return (
    <main class="visual-fixture">
      <header>
        <h1>Response Lens</h1>
        <p>{theme} / isolated component fixture</p>
      </header>
      <div ref={transcript} data-transcript-root data-session="visual" class="visual-transcript">
        <div data-row="assistant" data-session="visual" data-message="answer">
          <div data-component="text-part">
            <p id="selection">{text}</p>
          </div>
        </div>
      </div>
      <div class="visual-dock">
        <AnnotationList
          annotations={annotations()}
          editingID={editor()?.annotation.id}
          onEdit={(annotation, rect, trigger, count) => {
            primary = trigger
            fallback = count
            setEditor(openAnnotationEditor(annotation, rect))
          }}
          onDelete={(id) => setAnnotations((items) => items.filter((item) => item.id !== id))}
          onClear={() => setAnnotations([])}
        />
        <TextField ref={prompt} label="Prompt draft" multiline rows={2} value="Untouched prompt draft" />
        <Button variant="ghost" size="small" onClick={() => prompt.focus()}>
          Focus prompt
        </Button>
      </div>
      <AnnotationEditorHost
        editor={editor}
        onCommentChange={(id, comment) => setEditor((current) => updateAnnotationEditor(current, id, comment))}
        onSave={(focus) => {
          const result = commitAnnotationEditor(editor(), annotations())
          if (result.status !== "committed") return false
          setAnnotations(result.annotations)
          close(focus)
          return true
        }}
        onCancel={close}
        onDelete={(id) => {
          setAnnotations((items) => items.filter((item) => item.id !== id))
          close(true)
        }}
      />
      <ResponseLens
        transcript={() => transcript}
        streamingMessageIDs={() => new Set()}
        disabled={() => false}
        editing={() => !!editor()}
        focus={() => prompt}
        onAdd={(capture) => {
          primary = prompt
          fallback = undefined
          setEditor(
            openAnnotationEditor(
              newAnnotation({ sessionID: "visual", messageID: "answer", selectedText: capture.text, comment: "" }),
              capture.rect,
            ),
          )
        }}
      />
    </main>
  )
}

render(
  () => (
    <LanguageContext.Provider value={language as never}>
      <VSCodeProvider>
        <ConfigProvider>
          <ProviderContext.Provider
            value={
              {
                connected: () => ["test"],
                models: () => [model],
                findModel: (value: { modelID: string } | null) => (value?.modelID === model.id ? model : undefined),
              } as never
            }
          >
            <SessionContext.Provider
              value={
                {
                  currentSessionID: () => "visual",
                  selected: () => ({ providerID: "test", modelID: "fixture" }),
                  visibleMessages: () => [
                    { id: "question", sessionID: "visual", role: "user" },
                    { id: "answer", sessionID: "visual", role: "assistant" },
                  ],
                  getParts: (id: string) => [{ id, type: "text", text: id === "answer" ? text : "Explain precision." }],
                  favoriteModels: () => [],
                  modelUsageHistory: () => ({}),
                  recentModels: () => [],
                } as never
              }
            >
              <Fixture />
            </SessionContext.Provider>
          </ProviderContext.Provider>
        </ConfigProvider>
      </VSCodeProvider>
    </LanguageContext.Provider>
  ),
  document.getElementById("root")!,
)
post({
  type: "configLoaded",
  config: {},
  features: { indexing: false, sandboxControls: false, backgroundSubagents: false },
})
post({
  type: "chatSettingsLoaded",
  settings: { shiftTabCyclesVariant: true, responseLens: { enabled: true, level: "simple" } },
})
