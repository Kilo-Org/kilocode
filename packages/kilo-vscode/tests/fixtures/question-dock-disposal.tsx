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
  Event: window.Event,
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

const defaults: QuestionRequest = {
  ...request,
  questions: [
    {
      question: "Choose a format",
      header: "Format",
      options: [
        { label: "Text", description: "Plain text" },
        { label: "JSON", description: "Structured output" },
      ],
      default: "JSON",
    },
  ],
}
for (const value of ["", "Draft in progress"]) {
  prompt.value = value
  prompt.focus()
  setActive(defaults)
  flush()
  if (document.activeElement !== prompt) throw new Error("Default answer stole composer focus")
  setActive(structuredClone(defaults))
  flush()
  if (document.activeElement !== prompt) throw new Error("Repeated default answer stole composer focus")
  setActive(undefined)
  prompt.blur()
  setActive(defaults)
  prompt.focus()
  flush()
  if (document.activeElement !== prompt) throw new Error("Scheduled default focus interrupted typing")
  setActive(undefined)
}
prompt.value = ""
prompt.blur()
setActive(defaults)
flush()
const picked = root.querySelector<HTMLButtonElement>('button[data-picked="true"]')
if (!picked || picked.textContent?.includes("JSON") !== true) throw new Error("Default answer was not selected")
if (document.activeElement !== picked) throw new Error("Default answer was not focused")
if (calls.length !== 1) throw new Error("Default answer was submitted without confirmation")
picked.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }))
if (calls.length !== 1) throw new Error("IME Enter submitted the default answer")
picked.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
if (calls.at(-1)?.answers[0]?.[0] !== "JSON") throw new Error("Enter did not submit the default answer")
if (root.querySelector('[data-component="question-dock"]')) throw new Error("Default answer was not submitted")

setActive(structuredClone(defaults))
flush()
const replacement = root.querySelector<HTMLButtonElement>('[data-slot="question-option"]')
if (!replacement) throw new Error("Replacement option missing")
replacement.click()
if (replacement.dataset.picked !== "true") throw new Error("Could not override the default answer")
setActive(structuredClone(defaults))
flush()
const retained = root.querySelector<HTMLButtonElement>('button[data-picked="true"]')
if (!retained?.textContent?.includes("Text")) throw new Error("Repeated question reset the user's selection")
retained.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
if (calls.at(-1)?.answers[0]?.[0] !== "Text") throw new Error("Enter did not submit the replacement")

for (const question of [
  { ...defaults.questions.at(0)!, default: "Missing" },
  { ...defaults.questions.at(0)!, multiple: true },
  { ...defaults.questions.at(0)!, default: undefined },
]) {
  setActive({ ...request, questions: [question] })
  flush()
  if (root.querySelector('button[data-picked="true"]')) throw new Error("Unexpected default selection")
  const button = root.querySelector<HTMLButtonElement>('[data-slot="question-footer-actions"] button')
  if (!button?.disabled) throw new Error("Unanswered question enabled submission")
  const option = root.querySelector<HTMLButtonElement>('[data-slot="question-option"]')
  if (!option) throw new Error("Question option missing")
  option.click()
  option.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  if (!root.querySelector('[data-component="question-dock"]')) throw new Error("Ignored default changed Enter behavior")
  setActive(undefined)
}
dispose()
