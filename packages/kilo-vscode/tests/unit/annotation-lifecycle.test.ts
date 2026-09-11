import { afterEach, expect, it } from "bun:test"
import { Window } from "happy-dom"
import { createAnnotationLifecycle } from "../../webview-ui/diff-viewer/annotation-lifecycle"
import type { AnnotationMeta } from "../../webview-ui/diff-viewer/review-annotations"

const previous = { document: globalThis.document, MutationObserver: globalThis.MutationObserver }
afterEach(() => Object.assign(globalThis, previous))

it("releases a wrapper that is never inserted", async () => {
  const window = new Window()
  Object.assign(globalThis, { document: window.document, MutationObserver: window.MutationObserver })
  const lifecycle = createAnnotationLifecycle()
  const meta: AnnotationMeta = { type: "draft", comment: null, file: "never.ts", side: "additions", line: 1 }
  let released = 0
  lifecycle.track(meta, document.createElement("div"), () => released++)
  document.body.append(document.createElement("span"))
  await window.happyDOM.waitUntilComplete()
  expect(released).toBe(1)
  lifecycle.clear()
  await window.happyDOM.close()
})

it("disposes detached and replaced annotation roots exactly once", async () => {
  const window = new Window()
  Object.assign(globalThis, { document: window.document, MutationObserver: window.MutationObserver })
  const lifecycle = createAnnotationLifecycle()
  const meta: AnnotationMeta = { type: "draft", comment: null, file: "test.ts", side: "additions", line: 1 }
  const host = document.createElement("div")
  let released = 0
  lifecycle.track(meta, host, () => released++)
  document.body.append(host)
  await window.happyDOM.waitUntilComplete()
  expect(released).toBe(0)
  host.remove()
  await window.happyDOM.waitUntilComplete()
  expect(released).toBe(1)
  lifecycle.track(meta, host, () => released++)
  lifecycle.track(meta, document.createElement("div"), () => released++)
  expect(released).toBe(2)
  lifecycle.clear()
  lifecycle.clear()
  expect(released).toBe(3)
  await window.happyDOM.close()
})
