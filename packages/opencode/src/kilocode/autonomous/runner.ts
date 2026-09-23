import { Context, Effect, Schema } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Agent } from "@/agent/agent"
import { KiloSession } from "@/kilocode/session"
import { SessionDrain } from "@/kilocode/session/drain"
import { Session } from "@/session/session"
import type { PromptInput } from "@/session/prompt"
import { MessageID, type SessionID } from "@/session/schema"
import type { AutonomousModels } from "./models"

/**
 * The one execution primitive of the engine: run a child session with a given
 * agent and model, require a schema-validated StructuredOutput reply, retry on
 * invalid output, and report cost and tokens.
 */
export namespace AutonomousRunner {
  /** Prompt functions, injected so the engine can be built inside the SessionPrompt layer. */
  export type OpsShape = {
    readonly prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, unknown>
    readonly cancel: (sessionID: SessionID, scope?: "session" | "tree") => Effect.Effect<void>
  }
  export class Ops extends Context.Service<Ops, OpsShape>()("@kilo/AutonomousRunnerOps") {}

  export class Invalid extends Schema.TaggedErrorClass<Invalid>()("AutonomousRunnerInvalid", {
    sessionID: Schema.String,
    attempts: Schema.Number,
    message: Schema.String,
  }) {}

  export class Failed extends Schema.TaggedErrorClass<Failed>()("AutonomousRunnerFailed", {
    sessionID: Schema.String,
    message: Schema.String,
  }) {}

  export type Tokens = { input: number; output: number }

  export type Input<S extends Schema.Decoder<unknown>> = {
    parent: SessionID
    title: string
    agent: string
    model: AutonomousModels.Ref
    schema: S
    text: string
    /** Re-prompts after an invalid or missing structured reply. Default 1. */
    retries?: number
  }

  export type Output<A> = {
    value: A
    sessionID: SessionID
    cost: number
    tokens: Tokens
    /** Last plain text the model produced, for logs. */
    text: string
  }

  export function jsonSchema<S extends Schema.Top>(schema: S): Record<string, unknown> {
    const std = Schema.toStandardJSONSchemaV1(schema)["~standard"] as {
      jsonSchema: { input: (opts: { target: "draft-07" }) => Record<string, unknown> }
    }
    return std.jsonSchema.input({ target: "draft-07" })
  }

  const usage = (messages: SessionV1.WithParts[], seen: Set<string>) => {
    const out = { cost: 0, tokens: { input: 0, output: 0 }, text: "" }
    for (const msg of messages) {
      if (msg.info.role !== "assistant" || seen.has(msg.info.id)) continue
      seen.add(msg.info.id)
      out.cost += msg.info.cost
      out.tokens.input += msg.info.tokens.input + msg.info.tokens.cache.read
      out.tokens.output += msg.info.tokens.output + msg.info.tokens.reasoning
      const text = msg.parts.findLast((p) => p.type === "text" && !p.synthetic && !p.ignored && p.text.length > 0)
      if (text?.type === "text") out.text = text.text
    }
    return out
  }

  export const run = Effect.fn("AutonomousRunner.run")(function* <S extends Schema.Top & Schema.Decoder<unknown>>(input: Input<S>) {
    const sessions = yield* Session.Service
    const prompt = yield* Ops
    const drain = yield* SessionDrain.Service
    const agents = yield* Agent.Service
    const agent = yield* agents.get(input.agent).pipe(
      Effect.mapError((err) => new Failed({ sessionID: String(input.parent), message: `Agent ${input.agent} unavailable: ${String(err)}` })),
    )
    const session = yield* sessions.create({ parentID: input.parent, title: input.title, agent: agent.name })
    KiloSession.register({ id: session.id, parentID: input.parent, platform: KiloSession.resolvePlatform(input.parent) })
    yield* drain.link(session.id, input.parent)

    const decode = Schema.decodeUnknownExit(input.schema)
    const schema = jsonSchema(input.schema)
    const retries = Math.max(0, input.retries ?? 1)
    const seen = new Set<string>()
    const total = { cost: 0, tokens: { input: 0, output: 0 }, text: "" }
    const fail = (message: string) => new Failed({ sessionID: String(session.id), message })

    const turn = (text: string) =>
      prompt
        .prompt({
          sessionID: session.id,
          messageID: MessageID.ascending(),
          agent: agent.name,
          model: { providerID: input.model.providerID, modelID: input.model.modelID } as never,
          format: new SessionV1.OutputFormatJsonSchema({ type: "json_schema", schema, retryCount: 0 }),
          parts: [{ type: "text", text }],
        })
        .pipe(
          Effect.mapError((err) => fail(String(err))),
          Effect.onInterrupt(() => prompt.cancel(session.id, "tree")),
        )

    let text = input.text
    let last = ""
    for (let attempt = 0; attempt <= retries; attempt++) {
      const result = yield* turn(text)
      yield* drain.wait(session.id)
      const messages = yield* sessions.messages({ sessionID: session.id }).pipe(Effect.orDie)
      const used = usage(messages, seen)
      total.cost += used.cost
      total.tokens.input += used.tokens.input
      total.tokens.output += used.tokens.output
      if (used.text) total.text = used.text
      if (result.info.role !== "assistant") return yield* fail("Child session produced no assistant reply.")
      const err = result.info.error
      if (err && err.name !== "StructuredOutputError") return yield* fail(`${err.name}: ${"message" in err.data ? String(err.data.message) : ""}`)
      const exit = result.info.structured === undefined ? undefined : decode(result.info.structured)
      if (exit && exit._tag === "Success") {
        return { value: exit.value as S["Type"], sessionID: session.id, cost: total.cost, tokens: total.tokens, text: total.text } satisfies Output<S["Type"]>
      }
      last = exit ? String(exit.cause) : "no structured output was returned"
      text = `Your previous reply was rejected: ${last}\nCall the StructuredOutput tool again with a value that matches the schema exactly.`
    }
    return yield* new Invalid({ sessionID: String(session.id), attempts: retries + 1, message: last })
  })
}
