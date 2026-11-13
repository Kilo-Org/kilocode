import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = (path: string) => readFileSync(resolve(import.meta.dir, path), "utf8").replace(/\r\n/g, "\n")

const layout = source("../webview-ui/src/styles/chat-layout.css")
const messages = source("../webview-ui/src/v2/messages.tsx")

const ruleBody = (selector: string) => {
  const start = layout.indexOf(selector)
  if (start === -1) return undefined
  return layout.slice(layout.indexOf("{", start) + 1, layout.indexOf("}", start))
}

// The transcript is one readable lane. Putting it on the transcript's own
// children, not on a list of row kinds, keeps every row in the lane: a notice
// line or a tool part that a component adds later cannot fall out of it by not
// being listed in a selector. The instruction notice shown beside a read card
// is what used to land at the far left of a wide chat.
test("every transcript row shares the readable lane", () => {
  const body = ruleBody(".chat-view .message-list-content > *")

  expect(body).toBeDefined()
  expect(body).toContain("max-width: var(--chat-readable-width)")
  expect(body).toContain("margin-inline: auto")
})

// The lane rule only reaches rows that render inside the transcript content, so
// the virtual and direct rows both have to stay in that container.
test("virtual and direct rows render inside the transcript content", () => {
  const content = messages.slice(messages.indexOf('data-slot="message-list-content"'), messages.indexOf("<PromptRail"))

  expect(content).toContain('class="message-list-turns"')
  expect(content.indexOf("<Virtualizer")).toBeGreaterThan(content.indexOf('class="message-list-turns"'))
  expect(content.indexOf("<For each={directKeys()}>")).toBeGreaterThan(content.indexOf('class="message-list-turns"'))
})

// A tool renders its own rows inside one wrapper, so a result line such as the
// files a read loaded shares the wrapper's lane. The wrapper keeps no lane of
// its own: the transcript container owns it.
test("tool rows do not carry their own lane", () => {
  expect(ruleBody('.chat-view [data-component="tool-part-wrapper"]')).toBeUndefined()
})
