import { describe, expect, test } from "bun:test"
import { createReviewAppendQueue } from "../webview-ui/src/v2/review-queue"

describe("review append queue", () => {
  test("delivers a comment immediately while the prompt is mounted", () => {
    const queue = createReviewAppendQueue()
    const delivered: Array<[string, boolean]> = []
    queue.ready((value, send) => delivered.push([value, send]))

    queue.push("one", false)

    expect(delivered).toEqual([["one", false]])
  })

  test("holds comments until the prompt mounts and merges the batch", () => {
    const queue = createReviewAppendQueue()
    const delivered: Array<[string, boolean]> = []

    queue.push("one", false)
    queue.push("two", true)
    queue.ready((value, send) => delivered.push([value, send]))

    expect(delivered).toEqual([["one\n\ntwo", true]])
  })

  test("does not redeliver the batch after a second ready", () => {
    const queue = createReviewAppendQueue()
    const delivered: Array<[string, boolean]> = []

    queue.push("one", false)
    queue.ready((value, send) => delivered.push([value, send]))
    queue.ready((value, send) => delivered.push([value, send]))

    expect(delivered).toEqual([["one", false]])
  })

  test("queues again after the prompt unmounts", () => {
    const queue = createReviewAppendQueue()
    const delivered: Array<[string, boolean]> = []

    queue.ready(() => undefined)
    queue.ready(undefined)
    queue.push("one", true)
    queue.ready((value, send) => delivered.push([value, send]))

    expect(delivered).toEqual([["one", true]])
  })
})
