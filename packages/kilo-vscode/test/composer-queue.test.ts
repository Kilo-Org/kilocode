import { describe, expect, test } from "bun:test"
import type { PromptAttachment } from "../src/protocol"
import { createComposerQueue, type ComposerHandle } from "../webview-ui/src/v2/composer"

const item: PromptAttachment = {
  id: "a",
  kind: "selection",
  uri: "data:text/plain;base64,eA==",
  name: "math.ts:1",
}

function recorder() {
  const calls: unknown[] = []
  const handle: ComposerHandle = {
    attach: (items) => calls.push(["attach", items.map((entry) => entry.id)]),
    submit: (text, items) => calls.push(["submit", text, items.map((entry) => entry.id)]),
  }
  return { calls, handle }
}

describe("composer queue", () => {
  test("delivers at once while the composer is mounted", () => {
    const queue = createComposerQueue()
    const target = recorder()
    queue.ready(target.handle)

    queue.push({ type: "attach", items: [item] })
    queue.push({ type: "submit", text: "Explain", items: [item] })

    expect(target.calls).toEqual([
      ["attach", ["a"]],
      ["submit", "Explain", ["a"]],
    ])
  })

  test("holds requests in order until the composer mounts", () => {
    const queue = createComposerQueue()
    const target = recorder()

    queue.push({ type: "submit", text: "first", items: [] })
    queue.push({ type: "attach", items: [item] })
    queue.ready(target.handle)

    expect(target.calls).toEqual([
      ["submit", "first", []],
      ["attach", ["a"]],
    ])
  })

  test("queues again after the composer unmounts and does not redeliver", () => {
    const queue = createComposerQueue()
    const first = recorder()
    const second = recorder()

    queue.ready(first.handle)
    queue.push({ type: "attach", items: [item] })
    queue.ready(undefined)
    queue.push({ type: "submit", text: "later", items: [] })
    queue.ready(second.handle)
    queue.ready(second.handle)

    expect(first.calls).toEqual([["attach", ["a"]]])
    expect(second.calls).toEqual([["submit", "later", []]])
  })
})
