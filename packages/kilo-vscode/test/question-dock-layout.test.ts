import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const layout = readFileSync(
  resolve(import.meta.dir, "../webview-ui/src/styles/chat-layout.css"),
  "utf8",
).replace(/\r\n/g, "\n")

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
