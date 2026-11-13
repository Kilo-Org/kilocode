import { expect, test } from "bun:test"
import { Config } from "@opencode/core/config"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Document, Info } from "@opencode/schema/config"
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

test("session_sync is an optional boolean Kilo setting preserved by config parsing", () => {
  const decode = Schema.decodeUnknownOption(KiloConfigPolicy.Info)
  for (const value of [true, false]) {
    const input = { session_sync: value, shell: "valid" }
    expect(Option.isSome(decode(input))).toBe(true)
    const normalized = ConfigNormalize.normalize(input)
    if (normalized.type !== "normalized") throw new Error("expected canonical normalization")
    expect(KiloConfigPolicy.parse(input, normalized.encoded)).toMatchObject(input)
  }
  expect(KiloConfigPolicy.parse({}, {})?.session_sync).toBeUndefined()
  expect(Option.isNone(decode({ session_sync: "false" }))).toBe(true)
  const diagnostics: ConfigNormalize.Diagnostic[] = []
  const parsed = KiloConfigPolicy.parse({ session_sync: "false", shell: "valid" }, { shell: "valid" }, (diagnostic) => diagnostics.push(diagnostic))
  expect(parsed?.shell).toBe("valid")
  expect(parsed?.session_sync).toBeUndefined()
  expect(diagnostics).toEqual([{ kind: "invalid", path: ["session_sync"], message: expect.stringContaining("expected a boolean") }])
})

test("remote_control is an optional boolean preserved beside canonical config", () => {
  const decode = Schema.decodeUnknownOption(KiloConfigPolicy.Info)
  for (const value of [true, false]) {
    const input = { remote_control: value, shell: "valid" }
    expect(Option.isSome(decode(input))).toBe(true)
    const normalized = ConfigNormalize.normalize(input)
    if (normalized.type !== "normalized") throw new Error("expected canonical normalization")
    expect(KiloConfigPolicy.parse(input, normalized.encoded)).toMatchObject(input)
  }
  expect(KiloConfigPolicy.parse({}, {})?.remote_control).toBeUndefined()
})

test.each(["true", 1, null, {}])("invalid remote_control %p is reported without discarding canonical settings", (value) => {
  const diagnostics: ConfigNormalize.Diagnostic[] = []
  const parsed = KiloConfigPolicy.parse({ remote_control: value, shell: "valid" }, { shell: "valid" }, (diagnostic) => diagnostics.push(diagnostic))
  expect(parsed?.shell).toBe("valid")
  expect(parsed?.remote_control).toBeUndefined()
  expect(diagnostics).toEqual([{ kind: "invalid", path: ["remote_control"], message: expect.stringContaining("expected a boolean") }])
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

test("privacy_mode is a boolean Kilo setting kept beside the canonical settings", () => {
  const input = { privacy_mode: true, shell: "valid" }
  const normalized = ConfigNormalize.normalize(input)
  if (normalized.type !== "normalized") throw new Error("expected canonical normalization")
  expect(normalized.diagnostics).toEqual([])
  const diagnostics: ConfigNormalize.Diagnostic[] = []
  const parsed = KiloConfigPolicy.parse(input, normalized.encoded, (diagnostic) => diagnostics.push(diagnostic))
  expect(parsed).toMatchObject({ privacy_mode: true, shell: "valid" })
  expect(diagnostics).toEqual([])
  expect(KiloConfigPolicy.parse({ privacy_mode: false }, {})?.privacy_mode).toBe(false)
})

test.each(["true", "yes", 1, null, {}])("an invalid privacy_mode %p is reported and not applied", (value) => {
  const input = { privacy_mode: value, hide_prompt_training_models: true, shell: "valid" }
  const diagnostics: ConfigNormalize.Diagnostic[] = []
  const parsed = KiloConfigPolicy.parse(input, { shell: "valid" }, (diagnostic) => diagnostics.push(diagnostic))
  expect(parsed?.privacy_mode).toBeUndefined()
  expect(parsed).toMatchObject({ hide_prompt_training_models: true, shell: "valid" })
  expect(diagnostics).toEqual([
    { kind: "invalid", path: ["privacy_mode"], message: expect.stringContaining("expected a boolean") },
  ])
  expect(KiloConfigPolicy.privacyMode(parsed ? [new Document({ type: "document", info: parsed })] : [])).toBe(false)
})

test("privacy mode is on when any effective document sets privacy_mode to true", () => {
  const document = (privacy_mode?: boolean) =>
    new Document({ type: "document", info: new KiloConfigPolicy.Info({ privacy_mode }) })
  expect(KiloConfigPolicy.privacyMode([])).toBe(false)
  expect(KiloConfigPolicy.privacyMode([document(), document(false)])).toBe(false)
  // global true, project unset or false
  expect(KiloConfigPolicy.privacyMode([document(true), document()])).toBe(true)
  expect(KiloConfigPolicy.privacyMode([document(true), document(false)])).toBe(true)
  // global false or unset, project true
  expect(KiloConfigPolicy.privacyMode([document(false), document(true)])).toBe(true)
  expect(KiloConfigPolicy.privacyMode([new Document({ type: "document", info: new Info({}) })])).toBe(false)
})

test("pages config merges per field, and the last document that sets a field wins", () => {
  const document = (pages?: { enabled?: boolean; destination?: "pages" | "pages-dev" }) =>
    new Document({ type: "document", info: new KiloConfigPolicy.Info({ pages }) })
  expect(KiloConfigPolicy.pagesConfig([])).toEqual({})
  expect(KiloConfigPolicy.pagesConfig([document(), document({})])).toEqual({ enabled: undefined, destination: undefined })
  // A nearer document that sets only the destination does not reset enabled.
  expect(KiloConfigPolicy.pagesConfig([document({ enabled: true }), document({ destination: "pages-dev" })])).toEqual({
    enabled: true,
    destination: "pages-dev",
  })
  expect(
    KiloConfigPolicy.pagesConfig([document({ enabled: true, destination: "pages-dev" }), document({ enabled: false, destination: "pages" })]),
  ).toEqual({ enabled: false, destination: "pages" })
})

test("the display layouts are Kilo settings, and an invalid layout is ignored", () => {
  const valid = {
    terminal_command_display: "collapsed",
    code_edit_display: "expanded",
    mcp_tool_display: "collapsed",
    code_mode_display: "expanded",
    shell: "valid",
  }
  const normalized = ConfigNormalize.normalize(valid)
  if (normalized.type !== "normalized") throw new Error("expected canonical normalization")
  expect(KiloConfigPolicy.parse(valid, normalized.encoded)).toMatchObject({
    terminal_command_display: "collapsed",
    code_edit_display: "expanded",
    mcp_tool_display: "collapsed",
    code_mode_display: "expanded",
  })

  const invalid = { terminal_command_display: "hidden", code_edit_display: "expanded", shell: "valid" }
  const parsed = KiloConfigPolicy.parse(invalid, { shell: "valid" })
  expect(parsed?.terminal_command_display).toBeUndefined()
  expect(parsed?.code_edit_display).toBe("expanded")
  expect(parsed?.shell).toBe("valid")
})

test("a v1 compaction threshold becomes the v2 buffer, keeping the native keys", () => {
  const input = { compaction: { threshold_percent: 80, auto: false, preserve_recent_tokens: 9000 } }
  const normalized = ConfigNormalize.normalize(input)
  if (normalized.type !== "normalized") throw new Error("expected canonical normalization")
  expect(KiloConfigPolicy.parse(input, normalized.encoded)).toMatchObject({
    compaction: { buffer: "20%", auto: false, keep: { tokens: 9000 } },
  })
  expect(KiloConfigPolicy.parse({ compaction: { threshold_percent: 100 } }, {})).toMatchObject({
    compaction: { buffer: 0 },
  })
})

test("an explicit v2 compaction buffer wins over the v1 threshold", () => {
  const input = { compaction: { threshold_percent: 80, buffer: "10%" } }
  const normalized = ConfigNormalize.normalize(input)
  if (normalized.type !== "normalized") throw new Error("expected canonical normalization")
  expect(KiloConfigPolicy.parse(input, normalized.encoded)).toMatchObject({ compaction: { buffer: "10%" } })

  const reserved = { compaction: { threshold_percent: 80, reserved: 12000 } }
  const folded = ConfigNormalize.normalize(reserved)
  if (folded.type !== "normalized") throw new Error("expected canonical normalization")
  expect(KiloConfigPolicy.parse(reserved, folded.encoded)).toMatchObject({ compaction: { buffer: 12000 } })
})

test("an invalid compaction threshold is ignored with a diagnostic and keeps the other settings", () => {
  const diagnostics: ConfigNormalize.Diagnostic[] = []
  const input = { compaction: { threshold_percent: 0, auto: false }, shell: "valid" }
  const normalized = ConfigNormalize.normalize(input)
  if (normalized.type !== "normalized") throw new Error("expected canonical normalization")
  const parsed = KiloConfigPolicy.parse(input, normalized.encoded, (diagnostic) => diagnostics.push(diagnostic))
  expect(parsed?.shell).toBe("valid")
  expect(parsed?.compaction).toMatchObject({ auto: false })
  expect(parsed?.compaction?.buffer).toBeUndefined()
  expect(diagnostics).toEqual([
    {
      kind: "invalid",
      path: ["compaction", "threshold_percent"],
      message: "ignored invalid compaction.threshold_percent; expected a percentage from 1 to 100",
    },
  ])
  expect(KiloConfigPolicy.parse({ compaction: { threshold_percent: null } }, {})?.compaction?.buffer).toBeUndefined()
})
