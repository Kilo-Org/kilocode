import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Form } from "@opencode/core/form"
import { Image } from "@opencode/core/image"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { QuestionTool } from "@opencode/core/tool/plugin/question"
import { KiloQuestion } from "@opencode/schema/kilocode/question"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../../core/test/lib/effect"
import { imagePassthrough } from "../../core/test/lib/image"
import { permissionLayer } from "../../core/test/lib/permission"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "../../core/test/lib/tool"
import { KiloQuestionPlugin } from "../src/question"

const sessionID = Session.ID.make("ses_kilo_question_test")

// The mocked services record what the tool asked for; `state` and `deny` select the outcome of the next call.
const recorded = { assertions: new Array<Permission.AssertInput>(), forms: new Array<Form.CreateInput>() }
let state: Form.TerminalState = { status: "answered", answer: {} }
let deny = false

const permission = permissionLayer({
  assert: (input) =>
    Effect.sync(() => recorded.assertions.push(input)).pipe(
      Effect.andThen(
        deny
          ? Effect.fail(new Permission.BlockedError({ rules: [], permission: input.action, resources: input.resources }))
          : Effect.void,
      ),
    ),
})
const form = Layer.mock(Form.Service, {
  ask: (input: Form.CreateInput) => Effect.sync(() => recorded.forms.push(input)).pipe(Effect.as(state)),
})

const build = (kilo: boolean, forms: "mock" | "real") =>
  AppNodeBuilder.build(
    LayerNode.group([
      Tool.node,
      Form.node,
      makeLocationNode({
        name: kilo ? "test/kilo-question-plugin" : "test/native-question-plugin",
        layer: Layer.effectDiscard(
          Effect.gen(function* () {
            yield* registerToolPlugin(QuestionTool.Plugin)
            if (kilo) yield* registerToolPlugin(KiloQuestionPlugin.Plugin)
          }),
        ),
        deps: [Tool.node, Permission.node, Form.node],
      }),
    ]),
    [
      Permission.node.replace(permission),
      ...(forms === "mock" ? [Form.node.replace(form)] : []),
      Image.node.replace(imagePassthrough),
    ],
  )

const layers = { native: build(false, "mock"), kilo: build(true, "mock") }

/** Calls the `question` tool on the native or the Kilo registry and returns everything the call produced. */
const call = (variant: keyof typeof layers, input: unknown) =>
  Effect.gen(function* () {
    recorded.assertions.length = 0
    recorded.forms.length = 0
    const registry = yield* Tool.Service
    const definition = (yield* toolDefinitions(registry)).find((tool) => tool.name === QuestionTool.name)
    const exit = yield* executeTool(registry, {
      sessionID,
      ...toolIdentity,
      call: { type: "tool-call", id: "call-question", name: QuestionTool.name, input },
    }).pipe(Effect.exit)
    return {
      definition,
      result: Exit.isSuccess(exit) ? exit.value : Cause.squash(exit.cause),
      assertions: [...recorded.assertions],
      forms: [...recorded.forms],
    }
  }).pipe(Effect.scoped, Effect.provide(layers[variant]), Effect.runPromise)

const both = async (input: unknown) => ({ native: await call("native", input), kilo: await call("kilo", input) })

/** The input with every Kilo hint removed, which is what the native tool accepts. */
const strip = (input: { questions: ReadonlyArray<KiloQuestion.Prompt> }) => ({
  questions: input.questions.map((question) => ({
    ...question,
    options: question.options.map((option) => ({ label: option.label, description: option.description })),
  })),
})

/** The JSON Schema without the Kilo hint properties of a question option. */
const withoutHints = (schema: unknown): unknown => {
  const copy = structuredClone(schema) as {
    properties: { questions: { items: { properties: { options: { items: { properties: Record<string, unknown> } } } } } }
  }
  const option = copy.properties.questions.items.properties.options.items.properties
  delete option.mode
  delete option.labelKey
  delete option.descriptionKey
  return copy
}

const hinted = {
  questions: [
    {
      question: "How should we continue?",
      header: "Next step",
      options: [
        { label: "Fix it", description: "Switch to the code agent", mode: "code" },
        { label: "Investigate", description: "Switch to the debug agent", mode: "debug" },
        { label: "Stop", description: "Do nothing" },
      ],
    },
    {
      question: "Which areas?",
      header: "Areas",
      multiple: true,
      options: [
        {
          label: "Tests",
          description: "Add tests",
          labelKey: "question.areas.tests",
          descriptionKey: "question.areas.tests.description",
        },
        { label: "Docs", description: "Update docs" },
      ],
    },
  ],
}

describe("KiloQuestion.Option: Kilo client hints", () => {
  test("Option class accepts and round-trips the mode field", () => {
    const raw = { label: "Continue here", description: "Implement the plan in this session", mode: "code" }
    const decoded = Schema.decodeUnknownSync(KiloQuestion.Option)(raw)
    expect(decoded.mode).toBe("code")
    expect(Schema.encodeSync(KiloQuestion.Option)(decoded)).toEqual(raw)
  })

  test("mode is optional — Option without it decodes cleanly", () => {
    const raw = { label: "Start new session", description: "Fresh session" }
    const decoded = Schema.decodeUnknownSync(KiloQuestion.Option)(raw)
    expect(decoded.mode).toBeUndefined()
    expect(Schema.encodeSync(KiloQuestion.Option)({ ...raw, mode: undefined })).not.toHaveProperty("mode")
  })

  test("Option class accepts and round-trips labelKey and descriptionKey", () => {
    const raw = {
      label: "Continue here",
      description: "Implement the plan in this session",
      labelKey: "plan.followup.answer.continue",
      descriptionKey: "plan.followup.answer.continue.description",
    }
    const decoded = Schema.decodeUnknownSync(KiloQuestion.Option)(raw)
    expect(decoded.labelKey).toBe("plan.followup.answer.continue")
    expect(decoded.descriptionKey).toBe("plan.followup.answer.continue.description")
  })

  test("the form metadata contract decodes the hints a client reads", () => {
    const metadata = {
      kind: "question",
      tool: { messageID: "msg_x", id: "call_x" },
      kilocode: { options: { q0: { "Fix it": { mode: "code" } } } },
    }
    expect(Schema.decodeUnknownSync(KiloQuestion.FormMetadata)(metadata).kilocode.options.q0["Fix it"].mode).toBe(
      "code",
    )
  })
})

describe("KiloQuestionPlugin", () => {
  test("tells the model it may send the hints, with their descriptions, and keeps the rest of upstream's schema", async () => {
    const result = await both(hinted)
    const option = (result.kilo.definition?.inputSchema as any).properties.questions.items.properties.options.items

    expect(option.properties.mode).toEqual({
      type: "string",
      description: "Optional agent/mode name to pre-select in the UI when this option is picked",
    })
    expect(option.properties.labelKey).toEqual({
      type: "string",
      description: "Optional i18n key for the label; clients translate and still reply with `label`",
    })
    expect(option.properties.descriptionKey).toEqual({
      type: "string",
      description: "Optional i18n key for the description",
    })
    expect(option.additionalProperties).toBe(false)
    expect(option.required).toEqual(["label", "description"])
    // Drift guard: any upstream change to the tool's name, description or input fields shows up here.
    expect({ ...result.kilo.definition, inputSchema: withoutHints(result.kilo.definition?.inputSchema) }).toEqual(
      result.native.definition!,
    )
  })

  test("accepts a call with mode and puts each option's hints on the pending form", async () => {
    state = { status: "answered", answer: { q0: "Fix it", q1: ["Tests", "Docs"] } }
    const kilo = await call("kilo", hinted)
    const native = await call("native", strip(hinted))

    expect(kilo.forms).toHaveLength(1)
    expect(kilo.forms[0].metadata).toEqual({
      kind: "question",
      tool: { messageID: toolIdentity.messageID, id: "call-question" },
      kilocode: {
        options: {
          q0: { "Fix it": { mode: "code" }, Investigate: { mode: "debug" } },
          q1: { Tests: { labelKey: "question.areas.tests", descriptionKey: "question.areas.tests.description" } },
        },
      },
    })
    // Same form fields, permission check and model-facing answer as upstream for the same question.
    expect({ ...kilo.forms[0], metadata: undefined }).toEqual({ ...native.forms[0], metadata: undefined })
    expect(kilo.assertions).toEqual(native.assertions)
    expect(kilo.result).toEqual(native.result)
    expect(kilo.result).toEqual({
      status: "completed",
      output: { answers: [["Fix it"], ["Tests", "Docs"]] },
      content: [
        {
          type: "text",
          text: 'User has answered your questions: "How should we continue?"="Fix it", "Which areas?"="Tests, Docs". You can now continue with the user\'s answers in mind.',
        },
      ],
      metadata: { answers: [["Fix it"], ["Tests", "Docs"]] },
    })
  })

  test("a call without hints behaves exactly as upstream", async () => {
    state = { status: "answered", answer: { q0: "Stop" } }
    const input = strip(hinted)
    const result = await both(input)

    expect(result.kilo.forms).toEqual(result.native.forms)
    expect(result.kilo.forms[0].metadata).toEqual({
      kind: "question",
      tool: { messageID: toolIdentity.messageID, id: "call-question" },
    })
    expect(result.kilo.assertions).toEqual(result.native.assertions)
    expect(result.kilo.result).toEqual(result.native.result)
  })

  test("a hinted call keeps upstream's dismissal, dismissal feedback, permission denial and input errors", async () => {
    const outcome = (result: Awaited<ReturnType<typeof call>>) =>
      result.result instanceof Error
        ? { error: result.result.constructor, message: result.result.message }
        : result.result
    const compare = async (input: { questions: ReadonlyArray<KiloQuestion.Prompt> }) => {
      const kilo = await call("kilo", input)
      const native = await call("native", strip(input))
      expect(outcome(kilo)).toEqual(outcome(native))
      expect(kilo.assertions).toEqual(native.assertions)
      return kilo
    }

    state = { status: "cancelled" }
    expect(outcome(await compare(hinted))).toEqual({
      error: QuestionTool.CancelledError,
      message: "The user dismissed this question",
    })

    state = { status: "cancelled", message: "No interactive client" }
    expect(outcome(await compare(hinted))).toEqual({
      status: "error",
      error: { type: "tool.execution", message: "No interactive client" },
    })

    deny = true
    try {
      const denied = await compare(hinted)
      expect(outcome(denied)).toEqual({
        status: "error",
        error: { type: "permission.rejected", message: "Permission denied: question" },
      })
      expect(denied.forms).toEqual([])
    } finally {
      deny = false
    }

    const empty = await both({ questions: [] })
    expect(empty.kilo.result).toEqual(empty.native.result)
    expect(empty.kilo.forms).toEqual([])
  })

  test("keys a repeated label by its first option", async () => {
    state = { status: "answered", answer: { q0: "Go" } }
    const result = await call("kilo", {
      questions: [
        {
          question: "Pick",
          header: "Pick",
          options: [
            { label: "Go", description: "First", mode: "code" },
            { label: "Go", description: "Second", mode: "debug" },
          ],
        },
      ],
    })
    expect(result.forms[0].metadata?.kilocode).toEqual({ options: { q0: { Go: { mode: "code" } } } })
  })
})

const real = testEffect(build(true, "real"))

describe("KiloQuestionPlugin with the real form service", () => {
  real.effect("the pending form carries the hints until the user answers, and the answer stays labels only", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const forms = yield* Form.Service
      const fiber = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-question-real", name: QuestionTool.name, input: hinted },
      }).pipe(Effect.forkScoped)

      const pending = yield* forms.list({ sessionID }).pipe(
        Effect.filterOrFail((list) => list.length === 1),
        Effect.retry({ times: 100 }),
      )
      const metadata = Schema.decodeUnknownSync(KiloQuestion.FormMetadata)(pending[0].metadata)
      expect(metadata.kilocode.options.q0).toEqual({ "Fix it": { mode: "code" }, Investigate: { mode: "debug" } })
      expect(pending[0].fields[0]).toMatchObject({
        options: [
          { value: "Fix it", label: "Fix it", description: "Switch to the code agent" },
          { value: "Investigate", label: "Investigate", description: "Switch to the debug agent" },
          { value: "Stop", label: "Stop", description: "Do nothing" },
        ],
      })

      yield* forms.reply({ id: pending[0].id, answer: { q0: "Investigate", q1: ["Docs"] } })
      expect(yield* Fiber.join(fiber)).toMatchObject({
        status: "completed",
        output: { answers: [["Investigate"], ["Docs"]] },
        metadata: { answers: [["Investigate"], ["Docs"]] },
      })
    }),
  )
})
