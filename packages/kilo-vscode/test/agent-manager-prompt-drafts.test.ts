import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = (path: string) => readFileSync(resolve(import.meta.dir, path), "utf8").replace(/\r\n/g, "\n")

const prompt = source("../webview-ui/src/v2/prompt.tsx")
const sessionView = source("../webview-ui/src/v2/session-view.tsx")
const selectors = source("../webview-ui/src/v2/selectors.tsx")

test("restores the composer text from the draft key and saves it on unmount", () => {
  expect(prompt).toContain("const drafts = new Map<string, string>()")
  expect(prompt).toContain("createSignal(promptDrafts.get(props.draftKey))")
  const cleanup = prompt.match(/onCleanup\(\(\) => \{\n    promptDrafts\.set\(draft, text\(\)\)([\s\S]*?)\n  \}\)/)?.[1]
  expect(cleanup).toBeDefined()
  expect(cleanup).toContain("attachmentDrafts.set(draft, attachments())")
  expect(cleanup).toContain("pasteDrafts.set(")
  expect(cleanup).toContain("keep(draft, browsers())")
  expect(cleanup).toContain("saveReviewDraft(draft, comments())")
})

test("keeps browser references and review comments with the draft they belong to", () => {
  const swap = prompt.match(/on\(\s*\(\) => props\.draftKey,([\s\S]*?)\n    \),/)?.[1]
  expect(swap).toContain("keep(draft, untrack(browsers))")
  expect(swap).toContain("setBrowsers(key ? (references.get(key) ?? []) : [])")
  expect(swap).toContain("saveReviewDraft(draft, untrack(comments))")
  expect(swap).toContain("setComments((key ? reviewDrafts.get(key) : undefined) ?? [])")
})

test("switching the draft key saves the old text and restores the new one", () => {
  const swap = prompt.match(/on\(\s*\(\) => props\.draftKey,([\s\S]*?)\n    \),/)?.[1]

  expect(swap).toBeDefined()
  expect(swap).toContain("promptDrafts.set(draft, untrack(text))")
  expect(swap).toContain("setText(value)")
  expect(swap).toContain("saveReviewDraft(draft, untrack(comments))")
  expect(swap).toContain("attachmentDrafts.set(draft, untrack(attachments))")
  expect(swap).toContain("paste.load(value, pasteDrafts.get(key))")
  expect(swap).toContain("setAttachments(attachmentDrafts.get(key))")
})

test("remounts the composer for each session or pending tab", () => {
  expect(sessionView).toContain('const draftKey = () => props.draftKey ?? session() ?? "new"')
  expect(sessionView).toContain("<Show when={draftKey()} keyed>")
  expect(sessionView).toContain("draftKey={key}")
})

test("resets the draft agent and model when the draft key changes", () => {
  const reset = selectors.match(/on\(\s*draftKey,\s*\(\) => \{([\s\S]*?)\},\s*\{ defer: true \}/)?.[1]

  expect(reset).toBeDefined()
  expect(reset).toContain("setDraftAgent(undefined)")
  expect(reset).toContain("setDraftModel(undefined)")
  expect(selectors).toContain("draftKey: Accessor<string | undefined> = session")
  expect(sessionView).toContain("createSelection(session, draftKey)")
})

test("a context action submit keeps the composer guards and falls back to the draft", () => {
  const submit = prompt.slice(prompt.indexOf("const submit = ("))
  expect(submit).toContain("if (!ready()")
  expect(submit).toContain("putInDraft(external.text, external.items)")
  expect(submit).toContain("if (external) return putInDraft(external.text, external.items)")
  expect(prompt).toContain("submit: (value, items, metadata) => submit({ text: value, items, metadata })")
})
