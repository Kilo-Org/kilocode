import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { FormInfo } from "@opencode/client"

const window = new Window({ url: "http://localhost" })
Object.defineProperty(window, "origin", { value: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  NodeList: window.NodeList,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  MessageEvent: window.MessageEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  customElements: window.customElements,
  acquireVsCodeApi: () => ({ postMessage: () => undefined, getState: () => undefined, setState: () => undefined }),
})
Object.assign(window, { KILO_SETTINGS: {} })

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Static imports would evaluate these modules before the happy-dom globals above exist.
const { render } = await import("solid-js/web")
const { DialogProvider } = await import("@kilocode/kilo-ui/context/dialog")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { V2Scope } = await import("../../webview-ui/src/v2/client")
const { QuestionDock } = await import("../../webview-ui/src/v2/question")
const { answerQuestion } = await import("../../webview-ui/src/v2/question-answer")

const replies: unknown[] = []
const errors: unknown[] = []
const scope = {
  report: (error: unknown) => void errors.push(error),
  directory: "/preview",
  open: () => undefined,
  data: { session: { form: { reply: async (input: unknown) => void replies.push(input) } } },
} as never

function dock(form: FormInfo) {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(
    () => (
      <DialogProvider>
        <VSCodeProvider>
          <LanguageProvider>
            <V2Scope value={scope}>
              <QuestionDock form={form} />
            </V2Scope>
          </LanguageProvider>
        </VSCodeProvider>
      </DialogProvider>
    ),
    host,
  )
  return {
    host,
    dispose() {
      dispose()
      host.remove()
    },
  }
}

const question = (input: {
  id: string
  fields: FormInfo["fields"]
  metadata?: FormInfo["metadata"]
}): FormInfo =>
  ({
    id: input.id,
    sessionID: "ses_1",
    title: "Questions",
    metadata: input.metadata ?? { kind: "question" },
    fields: input.fields,
  }) as unknown as FormInfo

const options = [
  { value: "Build", label: "Build", description: "Build it" },
  { value: "Review", label: "Review", description: "Review it" },
]

// A typed send from the main prompt answers the single question on screen, as v1.
{
  replies.length = 0
  const form = question({
    id: "frm_single",
    fields: [{ key: "q0", title: "Action", description: "What should happen?", type: "string", options, custom: true }],
  })
  const view = dock(form)
  await wait(20)
  assert.equal(await answerQuestion(form, " Also cover the login page "), true, "the dock takes the typed answer")
  await wait(20)
  assert.deepEqual(
    replies,
    [{ sessionID: "ses_1", formID: "frm_single", answer: { q0: "Also cover the login page" } }],
    "the trimmed typed text is the custom answer",
  )
  assert.deepEqual(errors, [], "the reply did not report an error")
  view.dispose()
}

// The VS Code plan follow-up keeps its dock row hidden (`composerReply`) but still accepts typed
// text, because the main prompt is the free-text input there.
{
  replies.length = 0
  const form = question({
    id: "frm_plan",
    metadata: { kind: "question", kilocode: { composerReply: true } },
    fields: [{ key: "q0", title: "Implement", description: "Ready to implement?", type: "string", options, custom: true }],
  })
  const view = dock(form)
  await wait(20)
  assert.equal(view.host.querySelector("[data-custom='true']"), null, "the redundant custom row stays hidden")
  assert.equal(await answerQuestion(form, "Also cover the login page"), true, "the composer still answers")
  await wait(20)
  assert.deepEqual(
    replies,
    [{ sessionID: "ses_1", formID: "frm_plan", answer: { q0: "Also cover the login page" } }],
    "the hidden row does not block the typed answer",
  )
  view.dispose()
}

// A multi-question form answers the visible question and advances; the review submits the rest.
{
  replies.length = 0
  const form = question({
    id: "frm_multi",
    fields: [
      { key: "q0", title: "Action", description: "First question?", type: "string", options, custom: true },
      { key: "q1", title: "Scope", description: "Second question?", type: "string", options, custom: true },
    ],
  })
  const view = dock(form)
  await wait(20)
  assert.equal(await answerQuestion(form, "First"), true, "the first typed answer advances the dock")
  await wait(20)
  assert.deepEqual(replies, [], "an unanswered later question keeps the form open")
  assert.ok(view.host.textContent?.includes("Second question?"), "the dock shows the next question")
  assert.equal(await answerQuestion(form, "Second"), true, "the second typed answer moves to review")
  await wait(20)
  const submit = [...view.host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Submit")
  assert.ok(submit, "the review offers Submit")
  submit.click()
  await wait(20)
  assert.deepEqual(
    replies,
    [{ sessionID: "ses_1", formID: "frm_multi", answer: { q0: "First", q1: "Second" } }],
    "the review submits every typed answer",
  )
  view.dispose()
}

assert.equal(await answerQuestion(question({ id: "frm_unmounted", fields: [] }), "lost"), undefined)
assert.deepEqual(errors, [], "no scenario reported an error")

await window.happyDOM.close()
