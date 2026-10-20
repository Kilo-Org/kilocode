// v1 fixture child: slow-snapshot interaction policy (U-E2-03). See v1.mjs.
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { $ } from "bun"
import { effect, source, url, write } from "./v1.mjs"

const TRACK = "packages/opencode/src/kilocode/snapshot/track.ts"
const { Effect, Layer } = await effect()
const { KiloSnapshotTrack: K } = await source(TRACK)
const { ConfigMigrateV1 } = await source("packages/core/src/v1/config/migrate.ts")
const { GlobalBus } = await source("packages/opencode/src/bus/global.ts")
const { AppRuntime } = await source("packages/opencode/src/effect/app-runtime.ts")
const { Question } = await source("packages/opencode/src/question/index.ts")
const { InstanceStore } = await source("packages/opencode/src/project/instance-store.ts")
const { InstanceRef } = await source("packages/opencode/src/effect/instance-ref.ts")
const { context } = await source("packages/opencode/src/project/instance-context.ts")
const { Snapshot } = await source("packages/opencode/src/snapshot/index.ts")
const { AppNodeBuilder } = await source("packages/core/src/effect/app-node-builder.ts")
const { EffectFlock } = await source("packages/core/src/util/effect-flock.ts")

const cases = []
const HASH = /^[0-9a-f]{40}$/
const mask = (hash) => (hash === undefined || hash === null ? null : HASH.test(hash) ? "<hash>" : hash)

// Timeouts are read from the environment when track.ts loads, so each value needs its own process.
for (const value of ["2500", "0", "-5", "abc", "1.5"]) {
  const code = `const m = await import(${JSON.stringify(url(TRACK))}); console.log("\\n" + JSON.stringify([m.KiloSnapshotTrack.TIMEOUT_MS, m.KiloSnapshotTrack.TURN_TIMEOUT_MS]))`
  const run = Bun.spawnSync([process.execPath, "--no-env-file", "-e", code], {
    env: { ...process.env, KILO_SNAPSHOT_TRACK_TIMEOUT_MS: value, KILO_SNAPSHOT_TURN_TIMEOUT_MS: value },
  })
  const [track, turn] = JSON.parse(run.stdout.toString().trim().split("\n").pop())
  cases.push({
    name: `env-timeout-${value}`,
    fn: "KiloSnapshotTrack.TIMEOUT_MS, TURN_TIMEOUT_MS (read at module load)",
    input: { KILO_SNAPSHOT_TRACK_TIMEOUT_MS: value, KILO_SNAPSHOT_TURN_TIMEOUT_MS: value },
    output: { TIMEOUT_MS: track, TURN_TIMEOUT_MS: turn },
  })
}

cases.push({
  name: "progress-part",
  fn: "KiloSnapshotTrack.progressPart",
  input: { sessionID: "ses_fixture", messageID: "msg_fixture", partID: "prt_fixture", frame: 1 },
  output: K.progressPart({
    sessionID: "ses_fixture",
    messageID: "msg_fixture",
    partID: "prt_fixture",
    text: K.formatProgress(K.PROGRESS_INITIALIZING, K.SPINNER_FRAMES[1]),
  }),
})

// wrap(): the decision at the question timeout, with recording hooks in place of the Question service.
const hang = () => Effect.promise(() => new Promise(() => {}))
const after = (ms, hash) => Effect.promise(() => new Promise((resolve) => setTimeout(() => resolve(hash), ms)))
const inners = {
  hang,
  fail: () => Effect.fail(new Error("boom")),
}
const wraps = [
  [
    "fast-under-timeout",
    { inner: { ms: 0, hash: "fast" }, timeoutMs: 100, sessionID: "ses_fixture", answer: "continue" },
  ],
  [
    "slow-but-under-timeout",
    { inner: { ms: 20, hash: "h20" }, timeoutMs: 200, sessionID: "ses_fixture", answer: "disable" },
  ],
  [
    "timeout-continue",
    { inner: { ms: 80, hash: "slowhash" }, timeoutMs: 20, sessionID: "ses_fixture", answer: "continue" },
  ],
  [
    "timeout-continue-no-hash",
    { inner: { ms: 80, hash: null }, timeoutMs: 20, sessionID: "ses_fixture", answer: "continue" },
  ],
  ["timeout-disable", { inner: "hang", timeoutMs: 20, sessionID: "ses_fixture", answer: "disable" }],
  ["timeout-dismissed", { inner: "hang", timeoutMs: 20, sessionID: "ses_fixture", answer: "dismissed" }],
  ["timeout-no-session", { inner: "hang", timeoutMs: 20, sessionID: null, answer: "continue" }],
  [
    "timeout-already-asked",
    { inner: "hang", timeoutMs: 20, sessionID: "ses_fixture", initial: { asked: true }, answer: "continue" },
  ],
  [
    "timeout-wait-policy",
    {
      inner: { ms: 80, hash: "waited" },
      timeoutMs: 20,
      sessionID: "ses_fixture",
      snapshotInitialization: "wait",
      answer: "disable",
    },
  ],
  [
    "already-disabled-for-session",
    {
      inner: "hang",
      timeoutMs: 20,
      sessionID: "ses_fixture",
      initial: { disabledForSession: true },
      answer: "continue",
    },
  ],
  ["inner-failure", { inner: "fail", timeoutMs: 100, sessionID: "ses_fixture", answer: "continue" }],
]
for (const [name, input] of wraps) {
  const state = Object.assign(K.makeState(), input.initial ?? {})
  const calls = { ask: [], persist: 0 }
  const result = await Effect.runPromise(
    K.wrap({
      inner:
        typeof input.inner === "string" ? inners[input.inner]() : after(input.inner.ms, input.inner.hash ?? undefined),
      state,
      sessionID: input.sessionID ?? undefined,
      messageID: input.sessionID ? "msg_fixture" : undefined,
      snapshotInitialization: input.snapshotInitialization,
      timeoutMs: input.timeoutMs,
      progressDelayMs: 10_000,
      hooks: {
        async ask(request) {
          calls.ask.push(request)
          return input.answer
        },
        async persistDisable() {
          calls.persist++
        },
        async startProgress() {},
        async updateProgress() {},
        async endProgress() {},
      },
    }),
  )
  cases.push({
    name,
    fn: "KiloSnapshotTrack.wrap",
    input,
    output: {
      result: result ?? null,
      asked: calls.ask,
      persistCalls: calls.persist,
      state: { disabledForSession: state.disabledForSession, asked: state.asked },
    },
  })
}

// protect(): the per-turn availability budget. After one timeout the guard skips the work for the session.
{
  const state = K.makeState()
  const first = await Effect.runPromise(
    K.protect({ inner: hang(), state, fallback: { hash: "base", files: [] }, operation: "patch", timeoutMs: 20 }),
  )
  const afterFirst = { ...state }
  let ran = false
  const second = await Effect.runPromise(
    K.protect({ inner: Effect.sync(() => ((ran = true), "x")), state, fallback: null, operation: "track" }),
  )
  cases.push({
    name: "turn-budget-timeout",
    fn: "KiloSnapshotTrack.protect",
    input: {
      first: { inner: "hang", timeoutMs: 20, fallback: { hash: "base", files: [] } },
      second: { inner: "succeeds", fallback: null },
    },
    output: { first, stateAfterFirst: afterFirst, second, secondInnerRan: ran },
  })
}

// The persisted v1 key and its v2 name.
for (const input of [{ snapshot: false }, { snapshot: true }, {}]) {
  cases.push({
    name: `config-migrate-${JSON.stringify(input)}`,
    fn: "ConfigMigrateV1.migrate",
    input,
    output: { isV1: ConfigMigrateV1.isV1(input), snapshots: ConfigMigrateV1.migrate(input).snapshots ?? null },
  })
}

// Real Question service, real persistDisable and a real Snapshot service after the next start.
const repo = async (files = {}) => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "slow-snapshot-")))
  await $`git init -q && git config commit.gpgsign false && git config user.email t@t && git config user.name t && git commit -q --allow-empty -m root`
    .cwd(dir)
    .quiet()
  for (const [relative, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, relative)), { recursive: true })
    await fs.writeFile(path.join(dir, relative), text)
  }
  return dir
}
const load = (directory, reload = false) =>
  AppRuntime.runPromise(InstanceStore.Service.use((s) => (reload ? s.reload({ directory }) : s.load({ directory }))))
const snapshotLayer = Layer.mergeAll(Snapshot.defaultLayer, AppNodeBuilder.build(EffectFlock.node))
const snapshot = (ctx, body) =>
  Effect.runPromise(
    Snapshot.Service.use(body).pipe(Effect.provide(snapshotLayer), Effect.provideService(InstanceRef, ctx)),
  )
const answerNext = (ctx, reply) => {
  const seen = Promise.withResolvers()
  const on = (event) => {
    if (event.payload?.type !== "question.asked") return
    GlobalBus.off("event", on)
    const request = event.payload.properties
    seen.resolve(request)
    const answer =
      reply === "reject"
        ? Question.Service.use((service) => service.reject(request.id))
        : Question.Service.use((service) => service.reply({ requestID: request.id, answers: [reply] }))
    setTimeout(
      () => context.provide(ctx, () => AppRuntime.runPromise(answer.pipe(Effect.provideService(InstanceRef, ctx)))),
      5,
    )
  }
  GlobalBus.on("event", on)
  return seen.promise
}
const configFiles = [".kilo/kilo.jsonc", ".kilo/kilo.json", "kilo.json", "opencode.json"]
const questions = [
  ["question-disable", [K.ANSWER_DISABLE], "hang", {}],
  ["question-continue", [K.ANSWER_CONTINUE], { ms: 150, hash: "slowhash" }, {}],
  ["question-reject", "reject", "hang", {}],
  ["question-unknown-label", ["Something else"], "hang", {}],
  [
    "question-disable-existing-kilo-json",
    [K.ANSWER_DISABLE],
    "hang",
    { ".kilo/kilo.json": JSON.stringify({ $schema: "https://app.kilo.ai/config.json", model: "a/b" }, null, 2) },
  ],
  [
    "question-disable-existing-jsonc-comment",
    [K.ANSWER_DISABLE],
    "hang",
    { ".kilo/kilo.jsonc": '{\n  // keep me\n  "model": "a/b"\n}\n' },
  ],
]
for (const [name, reply, inner, files] of questions) {
  const dir = await repo(files)
  const ctx = await load(dir)
  const state = K.makeState()
  const asked = answerNext(ctx, reply)
  const result = await context.provide(ctx, () =>
    AppRuntime.runPromise(
      K.wrap({
        inner: inner === "hang" ? hang() : after(inner.ms, inner.hash),
        state,
        sessionID: "ses_fixture",
        hooks: { ...K.defaultHooks, async startProgress() {}, async updateProgress() {}, async endProgress() {} },
        timeoutMs: 20,
      }).pipe(Effect.provideService(InstanceRef, ctx)),
    ),
  )
  const request = await Promise.race([asked, new Promise((resolve) => setTimeout(() => resolve(null), 2000))])
  const filesAfter = Object.fromEntries(
    (
      await Promise.all(
        configFiles.map(async (file) => [file, await fs.readFile(path.join(dir, file), "utf8").catch(() => null)]),
      )
    ).filter(([, text]) => text !== null),
  )
  // The next start: reload the instance so that config is read again, then ask the real Snapshot service.
  const next = await snapshot(await load(dir, true), (s) => s.track())
  cases.push({
    name,
    fn: "KiloSnapshotTrack.wrap with defaultHooks (Question service, persistDisable), then Snapshot.track after reload",
    input: { reply, inner, timeoutMs: 20, files },
    output: {
      question: request && { ...request, id: "que_<id>" },
      result: result ?? null,
      state: { disabledForSession: state.disabledForSession, asked: state.asked },
      filesAfter,
      nextStartTrack: mask(next),
    },
  })
}

// Whether the Snapshot service runs, from the config files of a project.
const decisions = [
  ["service-no-config", {}],
  ["service-opencode-json-disabled", { "opencode.json": JSON.stringify({ snapshot: false }) }],
  ["service-kilo-jsonc-disabled", { ".kilo/kilo.jsonc": '{ "snapshot": false }' }],
  ["service-kilo-jsonc-enabled", { ".kilo/kilo.jsonc": '{ "snapshot": true }' }],
]
for (const [name, files] of decisions) {
  const ctx = await load(await repo(files))
  const result = await snapshot(ctx, (s) =>
    Effect.gen(function* () {
      return { track: mask(yield* s.track()), cleanup: (yield* s.cleanup()) ?? null }
    }),
  )
  cases.push({ name, fn: "Snapshot.track, Snapshot.cleanup", input: { git: true, files }, output: result })
}
{
  const ctx = await load(await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "slow-snapshot-nogit-"))))
  cases.push({
    name: "service-not-git",
    fn: "Snapshot.track",
    input: { git: false, files: {} },
    output: { track: mask(await snapshot(ctx, (s) => s.track())) },
  })
}

await write({
  sources: [
    TRACK,
    "packages/opencode/src/snapshot/index.ts",
    "packages/opencode/src/kilocode/config/config.ts",
    "packages/opencode/src/question/index.ts",
    "packages/core/src/v1/config/migrate.ts",
  ],
  constants: {
    TIMEOUT_MS: K.TIMEOUT_MS,
    TURN_TIMEOUT_MS: K.TURN_TIMEOUT_MS,
    ANSWER_CONTINUE: K.ANSWER_CONTINUE,
    ANSWER_DISABLE: K.ANSWER_DISABLE,
    PROGRESS_INITIALIZING: K.PROGRESS_INITIALIZING,
    SPINNER_FRAMES: [...K.SPINNER_FRAMES],
    SPINNER_INTERVAL_MS: K.SPINNER_INTERVAL_MS,
    initialState: K.makeState(),
    persistedKey: "snapshot",
    persistedDefaultFile: ".kilo/kilo.jsonc",
    note: "wrap and protect cases pass short timeoutMs values; only the relation of inner time to timeoutMs matters. Hashes read <hash>.",
  },
  cases,
})
await AppRuntime.dispose().catch(() => {})
process.exit(0)
