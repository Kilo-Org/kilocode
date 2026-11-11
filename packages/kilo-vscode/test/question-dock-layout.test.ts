import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = (path: string) => readFileSync(resolve(import.meta.dir, path), "utf8").replace(/\r\n/g, "\n")

const layout = source("../webview-ui/src/styles/chat-layout.css")
const messages = source("../webview-ui/src/v2/messages.tsx")
const sessionView = source("../webview-ui/src/v2/session-view.tsx")

const ruleBody = (selector: string) => {
  const start = layout.indexOf(selector)
  if (start === -1) return undefined
  return layout.slice(layout.indexOf("{", start) + 1, layout.indexOf("}", start))
}

// The question dock streams inline at the end of the transcript, as in v1, so
// it scrolls with the output. It shares the readable lane of the other inline
// rows rather than spanning the whole surface width on wide layouts.
test("question dock keeps the transcript readable lane", () => {
  const body = ruleBody('.chat-view .message-list-content > [data-component="question-dock"]')

  expect(body).toBeDefined()
  expect(body).toContain("max-width: var(--chat-readable-width)")
  expect(body).toContain("margin-inline: auto")
})

// A composer-lane rule would re-pin the dock under the transcript and undo the
// scroll behavior even though the component renders inline.
test("question dock has no composer-lane rule", () => {
  expect(ruleBody('.chat-view .chat-input > [data-component="question-dock"]')).toBeUndefined()
})

// The transcript owns the dock, so it must not also be rendered above the
// prompt input, where it could not scroll with the conversation.
test("the question dock renders in the transcript only", () => {
  const composer = sessionView.match(/<div class="chat-input">([\s\S]*?)\n          <\/div>/)?.[1]

  expect(composer).toBeDefined()
  expect(composer).not.toContain("QuestionDock")
  expect(sessionView).toContain("question={() => (props.readOnly ? undefined : forms()[0])}")
  expect(messages).toContain("<QuestionDock form={form} />")
})

// The empty transcript layout centers its children in a row, so the dock would
// land beside the welcome screen without the readable lane.
test("a pending question keeps the transcript lane while the transcript is empty", () => {
  expect(messages).toContain('!props.question?.() ? "message-list-content-empty" : "message-list-content"')
})
