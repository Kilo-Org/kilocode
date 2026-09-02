import { Window } from "happy-dom"
import type { QuestionRequest } from "../../webview-ui/src/types/messages"

const window = new Window()
const frames: FrameRequestCallback[] = []
window.document.hasFocus = () => true
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  SVGElement: window.SVGElement,
  requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(callback),
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
const prompt = document.createElement("textarea")
prompt.className = "prompt-input"
document.body.append(prompt, root)
prompt.focus()
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

const flush = () => {
  while (frames.length) frames.shift()?.(0)
}
flush()
if (document.activeElement !== prompt) throw new Error("New question stole composer focus")
setActive(structuredClone(request))
flush()
if (document.activeElement !== prompt) throw new Error("Repeated question stole composer focus")

setActive(undefined)
prompt.blur()
setActive(structuredClone(request))
prompt.focus()
flush()
if (document.activeElement !== prompt) throw new Error("Scheduled question focus interrupted typing")

setActive(undefined)
prompt.blur()
setActive(structuredClone(request))
flush()
const option = root.querySelector<HTMLButtonElement>('[data-slot="question-option"]')
const submit = root.querySelector<HTMLButtonElement>('[data-slot="question-footer-actions"] button')
if (!option || !submit) throw new Error("Question controls did not render")
if (document.activeElement !== option) throw new Error("Question did not focus when no text field was active")
option.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
if (document.activeElement !== root.querySelector('[data-custom="true"]')) {
  throw new Error("Question keyboard navigation did not move to the next option")
}
option.click()
if (submit.disabled) throw new Error("Submit did not enable after selecting an answer")
submit.click()
if (calls.length !== 1 || calls[0]?.id !== request.id || calls[0]?.answers[0]?.[0] !== "Yes") {
  throw new Error(`Unexpected question reply: ${JSON.stringify(calls)}`)
}
if (root.querySelector('[data-component="question-dock"]')) throw new Error("Question dock did not unmount")
dispose()
