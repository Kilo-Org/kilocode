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

// v2 renders the question dock in the composer column, unlike v1 where it
// streamed inline inside the transcript lane. Without its own lane it spanned
// the whole surface width on wide layouts such as Agent Manager.
test("question dock keeps the composer readable lane", () => {
  const body = ruleBody('.chat-view .chat-input > [data-component="question-dock"]')

  expect(body).toBeDefined()
  expect(body).toContain("box-sizing: border-box")
  expect(body).toContain(
    "width: min(calc(100% - var(--prompt-gutter) - var(--prompt-gutter)), var(--chat-readable-width))",
  )
  expect(body).toContain("margin-inline: auto")
})
