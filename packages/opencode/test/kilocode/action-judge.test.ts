import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import pathmod from "node:path"
import { Effect, Exit, Option, Schema } from "effect"
import {
  basename,
  buildPayload,
  classify,
  enabled,
  evaluate,
  MalformedVerdict,
  ProviderCallError,
  provenReadOnly,
  route,
  runJudge,
  selectIntent,
  VerdictSchema,
  ModelVerdictSchema,
  type Judge,
  type JudgeInput,
  type MessageView,
  type ShellCommand,
} from "../../src/kilocode/gate/action-judge"

// FAKE judges only — the real model (makeModelJudge/generateObject) is never invoked here; live
// behaviour is covered by the two saved serve smoke-runs. We verify intent selection (exact turn,
// no positional fallback), the read-only fast path, verdict/fail-closed/abort handling, provider-
// absent fail-closed, real timeout cancellation, and the fixed reasonCode union.

const CLEAN_FLAGS = { hasRedirect: false, hasSubstitution: false, hasError: false }
const cmd = (executable: string, ...args: string[]): ShellCommand => ({ executable, args: [executable, ...args] })
const input: JudgeInput = { userIntent: "add type hints", cwd: "/work", command: "npm test", commands: [cmd("npm", "test")] }
const openSignal = () => new AbortController().signal
const abortedSignal = () => {
  const c = new AbortController()
  c.abort()
  return c.signal
}
const runExit = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromiseExit(e)

describe("ActionJudge.provenReadOnly — strict, data-safe read-only fast path", () => {
  test("only inert non-disclosing commands fast-path", () => {
    expect(provenReadOnly([cmd("pwd")], CLEAN_FLAGS)).toBe(true)
    expect(provenReadOnly([cmd("whoami"), cmd("id")], CLEAN_FLAGS)).toBe(true)
    expect(provenReadOnly([cmd("/usr/bin/uname", "-a")], CLEAN_FLAGS)).toBe(true) // basename-normalized
  })
  test("date and hostname are NOT fast-pathed (mutate system state with args)", () => {
    expect(provenReadOnly([cmd("date", "-s", "2020-01-01")], CLEAN_FLAGS)).toBe(false)
    expect(provenReadOnly([cmd("hostname", "evil")], CLEAN_FLAGS)).toBe(false)
    expect(provenReadOnly([cmd("date")], CLEAN_FLAGS)).toBe(false)
  })
  test("data-reading / disclosing commands NEVER fast-path (threat #3 hole closed)", () => {
    expect(provenReadOnly([cmd("cat", "/home/u/.ssh/id_rsa")], CLEAN_FLAGS)).toBe(false)
    expect(provenReadOnly([cmd("head", ".env")], CLEAN_FLAGS)).toBe(false)
    expect(provenReadOnly([cmd("printenv")], CLEAN_FLAGS)).toBe(false)
    expect(provenReadOnly([cmd("echo", "$TOKEN")], CLEAN_FLAGS)).toBe(false)
    expect(provenReadOnly([cmd("ls", "-la")], CLEAN_FLAGS)).toBe(false)
  })
  test("multi-command safe && dangerous -> false (not judged by first command alone)", () => {
    expect(provenReadOnly([cmd("pwd"), cmd("rm", "-rf", "x")], CLEAN_FLAGS)).toBe(false)
  })
  test("substitutions, redirections and unparsed input never fast-path", () => {
    expect(provenReadOnly([cmd("pwd")], { ...CLEAN_FLAGS, hasRedirect: true })).toBe(false)
    expect(provenReadOnly([cmd("pwd")], { ...CLEAN_FLAGS, hasSubstitution: true })).toBe(false)
    expect(provenReadOnly([cmd("pwd")], { ...CLEAN_FLAGS, hasError: true })).toBe(false)
    expect(provenReadOnly([], CLEAN_FLAGS)).toBe(false)
  })
})

describe("ActionJudge.selectIntent — exact turn-initiating message, no positional fallback", () => {
  const user = (id: string, text: string, extra: Partial<MessageView["parts"][number]> = {}): MessageView => ({
    info: { id, role: "user" },
    parts: [{ type: "text", text, ...extra }],
  })

  test("resolves the exact userMessageID even when the assistant message is NOT in messages", () => {
    // runtime shape: ctx.messages holds only the user turn; the in-flight assistant message is absent.
    expect(selectIntent([user("u1", "do X")], "u1").intent).toBe("do X")
  })
  test("a missing exact parent does NOT fall back to an older user turn", () => {
    const msgs = [user("u1", "OLD request"), user("u2", "NEW request")]
    expect(selectIntent(msgs, "u_absent").intent).toBeUndefined() // no fallback to positional last
  })
  test("undefined userMessageID -> no intent (caller fails closed with intent_missing)", () => {
    expect(selectIntent([user("u1", "x")], undefined).intent).toBeUndefined()
  })
  test("synthetic and ignored parts are excluded", () => {
    const m: MessageView = {
      info: { id: "u1", role: "user" },
      parts: [
        { type: "text", text: "real ask" },
        { type: "text", text: "SUMMARY injected", synthetic: true },
        { type: "text", text: "local warning", ignored: true },
      ],
    }
    expect(selectIntent([m], "u1").intent).toBe("real ask")
  })
  test("a fully synthetic parent yields no intent", () => {
    const m: MessageView = { info: { id: "u1", role: "user" }, parts: [{ type: "text", text: "s", synthetic: true }] }
    expect(selectIntent([m], "u1").intent).toBeUndefined()
  })
  test("carries the parent message model when present", () => {
    const m: MessageView = {
      info: { id: "u1", role: "user", model: { providerID: "openrouter", modelID: "x" } },
      parts: [{ type: "text", text: "hi" }],
    }
    expect(selectIntent([m], "u1").model).toEqual({ providerID: "openrouter", modelID: "x" })
  })
})

describe("ActionJudge.route — ordering contract", () => {
  test("tripwire short-circuits before the classifier", () => {
    expect(route({ tripwireBlocked: true, readOnly: false, hasIntent: true })).toBe("tripwire-block")
    expect(route({ tripwireBlocked: true, readOnly: true, hasIntent: true })).toBe("tripwire-block")
  })
  test("read-only short-circuits; missing intent blocks; otherwise classify", () => {
    expect(route({ tripwireBlocked: false, readOnly: true, hasIntent: false })).toBe("readonly-allow")
    expect(route({ tripwireBlocked: false, readOnly: false, hasIntent: false })).toBe("intent-missing-block")
    expect(route({ tripwireBlocked: false, readOnly: false, hasIntent: true })).toBe("classify")
  })
})

describe("ActionJudge.runJudge — verdict, fail-closed, abort, real cancellation", () => {
  const allow: Judge = () => Effect.succeed({ decision: "allow", reasonCode: "matches_intent" })
  const blockMismatch: Judge = () => Effect.succeed({ decision: "block", reasonCode: "off_intent" })
  const failProvider: Judge = () => Effect.fail(new ProviderCallError({ cause: "network" }))
  const failMalformed: Judge = () => Effect.fail(new MalformedVerdict())

  test("allow verdict passes through", async () => {
    expect(await Effect.runPromise(runJudge(allow, input, { signal: openSignal(), timeoutMs: 1000 }))).toEqual({
      decision: "allow",
      reasonCode: "matches_intent",
    })
  })
  test("mismatch verdict passes through as block", async () => {
    const v = await Effect.runPromise(runJudge(blockMismatch, input, { signal: openSignal(), timeoutMs: 1000 }))
    expect(v).toEqual({ decision: "block", reasonCode: "off_intent" })
  })
  test("provider error -> block(classifier_error) (fail closed)", async () => {
    const v = await Effect.runPromise(runJudge(failProvider, input, { signal: openSignal(), timeoutMs: 1000 }))
    expect(v).toEqual({ decision: "block", reasonCode: "classifier_error" })
  })
  test("malformed verdict -> block(classifier_malformed) (fail closed)", async () => {
    const v = await Effect.runPromise(runJudge(failMalformed, input, { signal: openSignal(), timeoutMs: 1000 }))
    expect(v).toEqual({ decision: "block", reasonCode: "classifier_malformed" })
  })
  test("timeout -> block(classifier_timeout) AND cancels the underlying operation", async () => {
    let cancelled = false
    const hanging: Judge = () =>
      Effect.tryPromise({
        try: (signal) =>
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              cancelled = true
              reject(new Error("aborted"))
            })
          }),
        catch: () => new ProviderCallError({ cause: "x" }),
      })
    const v = await Effect.runPromise(runJudge(hanging, input, { signal: openSignal(), timeoutMs: 20 }))
    expect(v).toEqual({ decision: "block", reasonCode: "classifier_timeout" })
    expect(cancelled).toBe(true) // the interrupted judge actually aborted its in-flight promise
  })
  test("aborted signal interrupts (NOT classifier_error)", async () => {
    const exit = await runExit(runJudge(allow, input, { signal: abortedSignal(), timeoutMs: 1000 }))
    expect(Exit.isFailure(exit)).toBe(true) // interruption is a failure exit, not a success(block)
  })
  test("aborted signal wins even when the judge would have failed", async () => {
    const exit = await runExit(runJudge(failProvider, input, { signal: abortedSignal(), timeoutMs: 1000 }))
    expect(Exit.isFailure(exit)).toBe(true)
  })
  test("judge receives ALL command nodes (multi-command)", async () => {
    let seen: JudgeInput | undefined
    const capture: Judge = (i) => {
      seen = i
      return Effect.succeed({ decision: "allow", reasonCode: "matches_intent" })
    }
    const multi: JudgeInput = { ...input, command: "pwd && rm -rf x", commands: [cmd("pwd"), cmd("rm", "-rf", "x")] }
    await Effect.runPromise(runJudge(capture, multi, { signal: openSignal(), timeoutMs: 1000 }))
    expect(seen?.commands.map((c) => c.executable)).toEqual(["pwd", "rm"])
  })
})

describe("ActionJudge.evaluate — single terminal telemetry record", () => {
  let file: string
  afterEach(() => {
    delete process.env["KILO_CLASSIFIER_TELEMETRY"]
    if (file && fs.existsSync(file)) fs.unlinkSync(file)
  })
  const readRecords = () =>
    fs
      .readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))

  const runEval = async (judge: Judge | "unavailable", signal = openSignal(), timeoutMs = 1000) => {
    file = pathmod.join(os.tmpdir(), `eval-tel-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`)
    process.env["KILO_CLASSIFIER_TELEMETRY"] = file
    const v = await Effect.runPromise(
      evaluate(judge, input, { signal, timeoutMs, sessionID: "ses", callID: "call", model: { providerID: "p", modelID: "m" } }),
    )
    return { verdict: v, records: readRecords() }
  }

  test("allow emits exactly one record (decision allow)", async () => {
    const { verdict, records } = await runEval(() => Effect.succeed({ decision: "allow", reasonCode: "matches_intent" }))
    expect(verdict.decision).toBe("allow")
    expect(records.length).toBe(1)
    expect(records[0].decision).toBe("allow")
    expect(records[0].callID).toBe("call")
  })
  test("provider error emits one record (classifier_error), tokens null", async () => {
    const { records } = await runEval(() => Effect.fail(new ProviderCallError({ cause: "x" })))
    expect(records.length).toBe(1)
    expect(records[0].reasonCode).toBe("classifier_error")
    expect(records[0].inputTokens).toBeNull()
  })
  test("timeout emits one record (classifier_timeout)", async () => {
    const { records } = await runEval(() => Effect.never, openSignal(), 20)
    expect(records.length).toBe(1)
    expect(records[0].reasonCode).toBe("classifier_timeout")
  })
  test("unavailable emits one record (classifier_unavailable)", async () => {
    const { verdict, records } = await runEval("unavailable")
    expect(verdict).toEqual({ decision: "block", reasonCode: "classifier_unavailable" })
    expect(records.length).toBe(1)
    expect(records[0].reasonCode).toBe("classifier_unavailable")
  })
})

describe("ActionJudge.classify — provider absent fails closed", () => {
  test("Option.none provider -> block(classifier_unavailable) (no fail-open)", async () => {
    const v = await Effect.runPromise(classify(Option.none(), undefined, input, openSignal(), "test-session", "call-x", 1000))
    expect(v).toEqual({ decision: "block", reasonCode: "classifier_unavailable" })
  })
})

describe("ActionJudge — decision-bound reason codes (no contradictory verdicts)", () => {
  const rejected = async (value: unknown) =>
    expect(Exit.isFailure(await runExit(Schema.decodeUnknownEffect(ModelVerdictSchema)(value)))).toBe(true)

  test("an arbitrary model reasonCode is rejected as malformed", async () => {
    const exit = await runExit(Schema.decodeUnknownEffect(VerdictSchema)({ decision: "block", reasonCode: "totally_made_up" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })
  test("model schema rejects allow + a block code (allow + credential_access)", async () => {
    await rejected({ decision: "allow", reasonCode: "credential_access" })
  })
  test("model schema rejects allow + an internal code (allow + classifier_timeout)", async () => {
    await rejected({ decision: "allow", reasonCode: "classifier_timeout" })
  })
  test("model schema rejects block + matches_intent", async () => {
    await rejected({ decision: "block", reasonCode: "matches_intent" })
  })
  test("model schema rejects any internal code from the model (block + classifier_error)", async () => {
    await rejected({ decision: "block", reasonCode: "classifier_error" })
  })
  test("valid model verdicts decode", async () => {
    const allow = await Effect.runPromise(
      Schema.decodeUnknownEffect(ModelVerdictSchema)({ decision: "allow", reasonCode: "matches_intent" }).pipe(Effect.orDie),
    )
    expect(allow).toEqual({ decision: "allow", reasonCode: "matches_intent" })
    const blocked = await Effect.runPromise(
      Schema.decodeUnknownEffect(ModelVerdictSchema)({ decision: "block", reasonCode: "data_exposure" }).pipe(Effect.orDie),
    )
    expect(blocked).toEqual({ decision: "block", reasonCode: "data_exposure" })
  })
  test("internal block codes are valid on the full VerdictSchema (gate-generated)", async () => {
    const v = await Effect.runPromise(
      Schema.decodeUnknownEffect(VerdictSchema)({ decision: "block", reasonCode: "classifier_timeout" }).pipe(Effect.orDie),
    )
    expect(v).toEqual({ decision: "block", reasonCode: "classifier_timeout" })
  })
})

describe("ActionJudge — misc", () => {
  test("feature flag is OFF by default (module inert unless KILO_ACTION_CLASSIFIER=1)", () => {
    expect(enabled).toBe(false)
  })
  test("basename normalizes the executable path", () => {
    expect(basename("/usr/bin/ls")).toBe("ls")
    expect(basename("rm")).toBe("rm")
  })
  test("payload carries the raw command as a structured data field", () => {
    const parsed = JSON.parse(buildPayload(input))
    expect(parsed.command).toBe("npm test")
    expect(parsed.userIntent).toBe("add type hints")
    expect(Array.isArray(parsed.commands)).toBe(true)
  })
})
