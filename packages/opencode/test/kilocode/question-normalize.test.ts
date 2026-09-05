import { expect, test } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Fiber, Queue, Schema } from "effect"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { KiloQuestion } from "../../src/kilocode/question"
import { Question } from "../../src/question"
import { SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Question.node, EventV2Bridge.node, CrossSpawnSpawner.node])))

for (const [name, input, line, text] of [
  ["bare CR", "Squash\rmerge", "Squash merge", "Squash merge"],
  ["CRLF", "Squash\r\nmerge", "Squash merge", "Squash\nmerge"],
  ["LF", "Squash\nmerge", "Squash merge", "Squash\nmerge"],
  ["literal escape", "Squash\\rmerge", "Squash\\rmerge", "Squash\\rmerge"],
  ["plain text", "Squash merge", "Squash merge", "Squash merge"],
  ["spaces and tabs", " \tSquash  \tmerge\t ", "Squash  \tmerge", " \tSquash  \tmerge\t "],
  ["whitespace around breaks", "Squash \t\r\n \tmerge", "Squash merge", "Squash \t\n \tmerge"],
  ["unicode whitespace", "Squash\u00a0\u2028merge", "Squash\u00a0\u2028merge", "Squash\u00a0\u2028merge"],
  ["only whitespace", " \t\r\n \t", "", " \t\n \t"],
  ["empty text", "", "", ""],
  ["mixed breaks", "Squash\rmerge\r\nnow\nplease", "Squash merge now please", "Squash merge\nnow\nplease"],
] as const) {
  test(`normalizes question ${name}`, () => {
    const result = KiloQuestion.normalize({
      header: input,
      question: input,
      options: [{ label: input, description: input }],
    })
    expect(result).toEqual({
      header: line,
      question: text,
      options: [{ label: line, description: text }],
    })
    expect(KiloQuestion.normalize(result)).toEqual(result)
  })
}

test("preserves long whitespace runs without breaks and collapses runs containing breaks", () => {
  const space = " \t".repeat(20_000)
  const label = `Squash${space}merge`
  const result = KiloQuestion.normalize({
    header: label,
    question: "How should we merge?",
    options: [
      { label, description: "Preserve whitespace" },
      { label: `Squash${space}\r\n${space}merge`, description: "Collapse line breaks" },
    ],
  })
  expect(result.header).toBe(label)
  expect(result.options.map((option) => option.label)).toEqual([label, "Squash merge"])
})

it.instance(
  "publishes and stores normalized questions and accepts their displayed labels",
  () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const bridge = yield* EventV2Bridge.Service
      const asked = yield* Queue.unbounded<Question.Request>()
      const off = yield* bridge.listen((event) => {
        if (event.type === Question.Event.Asked.type)
          Queue.offerUnsafe(asked, Schema.decodeUnknownSync(Question.Request)(event.data))
        return Effect.void
      })
      yield* Effect.addFinalizer(() => off)

      const input: Question.Info = {
        header: " Merge\r\n method ",
        question: "How\rshould we merge?\r\nKeep the history?",
        questionKey: "merge.question",
        headerKey: "merge.header",
        default: " Squash \r merge\n(Recommended) ",
        multiple: true,
        custom: false,
        options: [
          {
            label: " Squash \r merge\n(Recommended) ",
            description: "Combine\rcommits.\r\nKeep the message.\nThen merge.",
            labelKey: "merge.squash",
            descriptionKey: "merge.squash.description",
            mode: "code",
          },
          { label: "Keep commits", description: "Preserve history" },
        ],
      }
      const original = structuredClone(input)
      const fiber = yield* question
        .ask({ sessionID: SessionID.make("ses_test"), questions: [input], blocking: false })
        .pipe(Effect.forkScoped)
      const request = yield* Queue.take(asked).pipe(Effect.timeout("2 seconds"))

      expect(request.questions).toEqual([
        {
          ...input,
          default: "Squash merge (Recommended)",
          header: "Merge method",
          question: "How should we merge?\nKeep the history?",
          options: [
            {
              label: "Squash merge (Recommended)",
              description: "Combine commits.\nKeep the message.\nThen merge.",
              labelKey: "merge.squash",
              descriptionKey: "merge.squash.description",
              mode: "code",
            },
            { label: "Keep commits", description: "Preserve history" },
          ],
        },
      ])
      expect(request.blocking).toBe(false)
      expect(yield* question.list()).toEqual([request])
      expect(input).toEqual(original)

      const answers = [request.questions.flatMap((item) => item.options.map((option) => option.label))]
      yield* question.reply({ requestID: request.id, answers })
      expect(yield* Fiber.join(fiber)).toEqual([["Squash merge (Recommended)", "Keep commits"]])
      expect(yield* question.list()).toEqual([])
    }),
  { git: true },
)
