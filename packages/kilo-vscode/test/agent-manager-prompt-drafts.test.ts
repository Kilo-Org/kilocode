import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = (path: string) => readFileSync(resolve(import.meta.dir, path), "utf8")

const prompt = source("../webview-ui/src/v2/prompt.tsx")
const sessionView = source("../webview-ui/src/v2/session-view.tsx")
const selectors = source("../webview-ui/src/v2/selectors.tsx")

test("restores the composer text from the draft key and saves it on unmount", () => {
  expect(prompt).toContain("const drafts = new Map<string, string>()")
  expect(prompt).toContain("createSignal(promptDrafts.get(props.draftKey))")
  expect(prompt).toContain("onCleanup(() => promptDrafts.set(draft, text()))")
})

test("switching the draft key saves the old text and restores the new one", () => {
  const swap = prompt.match(/on\(\s*\(\) => props\.draftKey,([\s\S]*?)\n    \),/)?.[1]

  expect(swap).toBeDefined()
  expect(swap).toContain("promptDrafts.set(draft, untrack(text))")
  expect(swap).toContain("setText(value)")
})

test("remounts the composer for each session or pending tab", () => {
  expect(sessionView).toContain('const draftKey = () => props.draftKey ?? session() ?? "new"')
  expect(sessionView).toContain("<Show when={draftKey()} keyed>")
  expect(sessionView).toContain("draftKey={key}")
})

test("resets the draft agent and model when the session changes", () => {
  const reset = selectors.match(/on\(\s*session,\s*\(\) => \{([\s\S]*?)\},\s*\{ defer: true \}/)?.[1]

  expect(reset).toBeDefined()
  expect(reset).toContain("setDraftAgent(undefined)")
  expect(reset).toContain("setDraftModel(undefined)")
})
