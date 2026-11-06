import { describe, expect, test } from "bun:test"
import { createReviewAppendQueue } from "../webview-ui/src/v2/review-queue"
import type { ReviewCommentEntry } from "../src/shared/review-comments"

const comment = (id: string): ReviewCommentEntry => ({
  id,
  file: "src/a.ts",
  side: "additions",
  line: 1,
  comment: `text ${id}`,
  selectedText: "",
})

describe("review append queue", () => {
  test("delivers a comment immediately while the prompt is mounted", () => {
    const queue = createReviewAppendQueue()
    const delivered: Array<[ReviewCommentEntry[], boolean]> = []
    queue.ready((comments, send) => delivered.push([comments, send]))

    queue.push([comment("one")], false)

    expect(delivered).toEqual([[[comment("one")], false]])
  })

  test("holds comments until the prompt mounts and merges the batch", () => {
    const queue = createReviewAppendQueue()
    const delivered: Array<[ReviewCommentEntry[], boolean]> = []

    queue.push([comment("one")], false)
    queue.push([comment("two")], true)
    queue.ready((comments, send) => delivered.push([comments, send]))

    expect(delivered).toEqual([[[comment("one"), comment("two")], true]])
  })

  test("does not redeliver the batch after a second ready", () => {
    const queue = createReviewAppendQueue()
    const delivered: Array<[ReviewCommentEntry[], boolean]> = []

    queue.push([comment("one")], false)
    queue.ready((comments, send) => delivered.push([comments, send]))
    queue.ready((comments, send) => delivered.push([comments, send]))

    expect(delivered).toEqual([[[comment("one")], false]])
  })

  test("queues again after the prompt unmounts", () => {
    const queue = createReviewAppendQueue()
    const delivered: Array<[ReviewCommentEntry[], boolean]> = []

    queue.ready(() => undefined)
    queue.ready(undefined)
    queue.push([comment("one")], true)
    queue.ready((comments, send) => delivered.push([comments, send]))

    expect(delivered).toEqual([[[comment("one")], true]])
  })
})
