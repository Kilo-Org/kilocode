import { describe, expect, test } from "bun:test"
import { createReviewAppendQueue } from "../webview-ui/src/v2/review-queue"
import type { SendIntent } from "../src/shared/prompt-send"
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
    const delivered: Array<[ReviewCommentEntry[], SendIntent]> = []
    queue.ready((comments, send) => delivered.push([comments, send]))

    queue.push([comment("one")], "enter")

    expect(delivered).toEqual([[[comment("one")], "enter"]])
  })

  test("holds comments until the prompt mounts and merges the batch", () => {
    const queue = createReviewAppendQueue()
    const delivered: Array<[ReviewCommentEntry[], SendIntent]> = []

    queue.push([comment("one")], "enter")
    queue.push([comment("two")], "alternate")
    queue.ready((comments, send) => delivered.push([comments, send]))

    expect(delivered).toEqual([[[comment("one"), comment("two")], "alternate"]])
  })

  test("an Option-click in the batch sends all of it, a plain one keeps Enter's send", () => {
    const queue = createReviewAppendQueue()
    const delivered: Array<[ReviewCommentEntry[], SendIntent]> = []

    queue.push([comment("one")], "enter")
    queue.push([comment("two")], "enter")
    queue.ready((comments, send) => delivered.push([comments, send]))

    expect(delivered).toEqual([[[comment("one"), comment("two")], "enter"]])
  })

  test("does not redeliver the batch after a second ready", () => {
    const queue = createReviewAppendQueue()
    const delivered: Array<[ReviewCommentEntry[], SendIntent]> = []

    queue.push([comment("one")], "enter")
    queue.ready((comments, send) => delivered.push([comments, send]))
    queue.ready((comments, send) => delivered.push([comments, send]))

    expect(delivered).toEqual([[[comment("one")], "enter"]])
  })

  test("queues again after the prompt unmounts", () => {
    const queue = createReviewAppendQueue()
    const delivered: Array<[ReviewCommentEntry[], SendIntent]> = []

    queue.ready(() => undefined)
    queue.ready(undefined)
    queue.push([comment("one")], "alternate")
    queue.ready((comments, send) => delivered.push([comments, send]))

    expect(delivered).toEqual([[[comment("one")], "alternate"]])
  })
})
