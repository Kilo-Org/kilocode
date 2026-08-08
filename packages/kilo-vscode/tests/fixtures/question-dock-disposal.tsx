import { Window } from "happy-dom"
import type { QuestionRequest } from "../../webview-ui/src/types/messages"

const window = new Window()
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  SVGElement: window.SVGElement,
  requestAnimationFrame: () => 0,
})

const { Show, createSignal } = await import("solid-js")
const { render } = await import("solid-js/web")
const { SessionContext } = await import("../../webview-ui/src/context/session")
const { LanguageContext } = await import("../../webview-ui/src/context/language")
const { ConfigContext } = await import("../../webview-ui/src/context/config")
const { QuestionDock } = await import("../../webview-ui/src/components/chat/QuestionDock")

const request: QuestionRequest = {
  id: "question-1",
  sessionID: "session-1",
  questions: [
    {
      question: "Continue?",
      header: "Confirm",
      options: [{ label: "Yes", description: "Continue" }],
    },
  ],
}
const [active, setActive] = createSignal<QuestionRequest | undefined>(request)
const calls: Array<{ id: string; answers: string[][] }> = []
const session = {
  questionErrors: () => new Set<string>(),
  selectedAgent: () => "code",
  selectAgent: () => {},
  replyToQuestion: (id: string, answers: string[][]) => {
    calls.push({ id, answers })
    setActive(undefined)
  },
  rejectQuestion: () => {},
  closeQuestion: () => {},
}
const language = {
  locale: () => "en",
  setLocale: () => {},
  userOverride: () => "",
  t: (key: string) => key,
}
const root = document.createElement("div")
document.body.append(root)
const config = {
  config: () => ({}),
  globalConfig: () => ({}),
  projectConfig: () => ({}),
  settings: () => ({}),
  features: () => ({ indexing: false, sandboxControls: false }),
  loading: () => false,
  isDirty: () => false,
  saving: () => false,
  saveError: () => null,
  updateConfig: () => {},
  updateGlobalConfig: () => {},
  updateProjectConfig: () => {},
  updateSetting: () => {},
  saveConfig: () => {},
  discardConfig: () => {},
}
const dispose = render(
  () => (
    <SessionContext.Provider value={session as never}>
      <LanguageContext.Provider value={language as never}>
        <ConfigContext.Provider value={config as never}>
          <Show when={active()}>{(item) => <QuestionDock request={item()} />}</Show>
        </ConfigContext.Provider>
      </LanguageContext.Provider>
    </SessionContext.Provider>
  ),
  root,
)

const option = root.querySelector<HTMLButtonElement>('[data-slot="question-option"]')
const submit = root.querySelector<HTMLButtonElement>('[data-slot="question-footer-actions"] button')
if (!option || !submit) throw new Error("Question controls did not render")
option.click()
if (submit.disabled) throw new Error("Submit did not enable after selecting an answer")
submit.click()
if (calls.length !== 1 || calls[0]?.id !== request.id || calls[0]?.answers[0]?.[0] !== "Yes") {
  throw new Error(`Unexpected question reply: ${JSON.stringify(calls)}`)
}
if (root.querySelector('[data-component="question-dock"]')) throw new Error("Question dock did not unmount")
dispose()
