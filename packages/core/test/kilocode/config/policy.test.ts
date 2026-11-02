import { expect, test } from "bun:test"
import { Config } from "@opencode/core/config"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Document } from "@opencode/schema/config"
import { Effect, Option, Schema } from "effect"
import { it } from "../../lib/effect"

test("the exact top-level hide_prompt_training_models setting accepts only booleans", () => {
  const decode = Schema.decodeUnknownOption(KiloConfigPolicy.Info)
  expect(Option.isSome(decode({ hide_prompt_training_models: true }))).toBe(true)
  expect(Option.isSome(decode({ hide_prompt_training_models: false }))).toBe(true)
  expect(Option.isSome(decode({}))).toBe(true)
  expect(Option.isNone(decode({ hide_prompt_training_models: "true" }))).toBe(true)
  expect(ConfigNormalize.normalize({ hide_prompt_training_models: true }).diagnostics).toEqual([])
})

test.each(["true", null, 0])("invalid Kilo flag %p preserves canonical settings and managed policies", (value) => {
  const input = {
    hide_prompt_training_models: value,
    shell: "valid",
    policies: [{ effect: "deny", action: "tool.use", resource: "shell:*" }],
  } as const
  const normalized = ConfigNormalize.normalize(input)
  if (normalized.type !== "normalized") throw new Error("expected canonical normalization")
  const diagnostics: ConfigNormalize.Diagnostic[] = []
  const parsed = KiloConfigPolicy.parse(input, normalized.encoded, (diagnostic) => diagnostics.push(diagnostic))
  expect(parsed?.shell).toBe("valid")
  expect(parsed?.policies).toEqual(input.policies)
  expect(parsed?.hide_prompt_training_models).toBeUndefined()
  expect(diagnostics).toEqual([
    {
      kind: "invalid",
      path: ["hide_prompt_training_models"],
      message: expect.stringContaining("expected a boolean"),
    },
  ])
})

test("valid and omitted privacy values do not produce a diagnostic", () => {
  const diagnostics: ConfigNormalize.Diagnostic[] = []
  for (const value of [undefined, false, true]) {
    KiloConfigPolicy.parse({ hide_prompt_training_models: value }, {}, (diagnostic) => diagnostics.push(diagnostic))
  }
  expect(diagnostics).toEqual([])
})

it.effect("reads fresh effective entries without filesystem, global paths or plugin storage services", () =>
  Effect.gen(function* () {
    const config = yield* Config.Test
    const document = (hide?: boolean) =>
      new Document({
        type: "document",
        info: new KiloConfigPolicy.Info({ hide_prompt_training_models: hide }),
      })
    expect(yield* KiloConfigPolicy.get(config)).toEqual({ hide_prompt_training_models: false })
    yield* config.setEntries([document(false), document(true), document()])
    expect(yield* KiloConfigPolicy.get(config)).toEqual({ hide_prompt_training_models: true })
    yield* config.setEntries([document(true), document(false)])
    expect(yield* KiloConfigPolicy.get(config)).toEqual({ hide_prompt_training_models: false })
  }).pipe(Effect.provide(Config.testLayer())),
)

test("commit_message.prompt is a Kilo setting, and an invalid value keeps the other settings", () => {
  const valid = { commit_message: { prompt: "Write a haiku." }, shell: "valid" }
  const normalized = ConfigNormalize.normalize(valid)
  if (normalized.type !== "normalized") throw new Error("expected canonical normalization")
  expect(KiloConfigPolicy.parse(valid, normalized.encoded)?.commit_message).toEqual({ prompt: "Write a haiku." })

  const invalid = { commit_message: { prompt: 1 }, shell: "valid" }
  const diagnostics: ConfigNormalize.Diagnostic[] = []
  const parsed = KiloConfigPolicy.parse(invalid, { shell: "valid" }, (diagnostic) => diagnostics.push(diagnostic))
  expect(parsed?.shell).toBe("valid")
  expect(parsed?.commit_message).toBeUndefined()
  expect(diagnostics).toEqual([{ kind: "invalid", path: ["commit_message"], message: expect.any(String) }])
})

test("the last document that sets the commit message prompt wins, and an empty prompt means none", () => {
  const document = (prompt?: string) =>
    new Document({
      type: "document",
      info: new KiloConfigPolicy.Info({ commit_message: prompt === undefined ? undefined : { prompt } }),
    })
  expect(KiloConfigPolicy.commitMessagePrompt([])).toBeUndefined()
  expect(KiloConfigPolicy.commitMessagePrompt([document("global"), document()])).toBe("global")
  expect(KiloConfigPolicy.commitMessagePrompt([document("global"), document("project")])).toBe("project")
  expect(KiloConfigPolicy.commitMessagePrompt([document("global"), document("")])).toBeUndefined()
})

test("the display layouts are Kilo settings, and an invalid layout is ignored", () => {
  const valid = {
    terminal_command_display: "collapsed",
    code_edit_display: "expanded",
    mcp_tool_display: "collapsed",
    shell: "valid",
  }
  const normalized = ConfigNormalize.normalize(valid)
  if (normalized.type !== "normalized") throw new Error("expected canonical normalization")
  expect(KiloConfigPolicy.parse(valid, normalized.encoded)).toMatchObject({
    terminal_command_display: "collapsed",
    code_edit_display: "expanded",
    mcp_tool_display: "collapsed",
  })

  const invalid = { terminal_command_display: "hidden", code_edit_display: "expanded", shell: "valid" }
  const parsed = KiloConfigPolicy.parse(invalid, { shell: "valid" })
  expect(parsed?.terminal_command_display).toBeUndefined()
  expect(parsed?.code_edit_display).toBe("expanded")
  expect(parsed?.shell).toBe("valid")
})
