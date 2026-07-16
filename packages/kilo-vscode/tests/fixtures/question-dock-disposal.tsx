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
const session = {
  questionErrors: () => new Set<string>(),
  selectedAgent: () => "code",
  selectAgent: () => {},
  replyToQuestion: () => {},
  rejectQuestion: () => {},
  closeQuestion: () => {},
}
const language = {
  locale: () => "en",
  setLocale: () => {},
  userOverride: () => "",
  t: (key: string) => key,
}
const [active, setActive] = createSignal<QuestionRequest | undefined>(request)
const root = document.createElement("div")
const dispose = render(
  () => (
    <SessionContext.Provider value={session as never}>
      <LanguageContext.Provider value={language as never}>
        <Show when={active()}>{(item) => <QuestionDock request={item()} />}</Show>
      </LanguageContext.Provider>
    </SessionContext.Provider>
  ),
  root,
)

setActive(undefined)
dispose()
