// v1 fixture child: overflow accounting, threshold_percent, chunked compaction, payload recovery (U-E2-02). See v1.mjs.
import { effect, source, url, write } from "./v1.mjs"

const { Effect, Schema, Exit } = await effect()
const { APICallError } = await import(url("packages/opencode/node_modules/ai/dist/index.mjs"))
const { KiloSessionOverflow } = await source("packages/opencode/src/kilocode/session/overflow.ts")
const { usable, isOverflow } = await source("packages/opencode/src/session/overflow.ts")
const { KiloCompactionChunks } = await source("packages/opencode/src/kilocode/session/compaction-chunks.ts")
const { KiloCompactionPayloadRecovery } = await source(
  "packages/opencode/src/kilocode/session/compaction-payload-recovery.ts",
)
const { MessageV2 } = await source("packages/opencode/src/session/message-v2.ts")
const { ConfigV1 } = await source("packages/core/src/v1/config/config.ts")
const { KiloSessionPrompt } = await source("packages/opencode/src/kilocode/session/prompt.ts")

const NOW = 1_700_000_000_000
Date.now = () => NOW // strip() stamps time.compacted with Date.now()

// Fixture inputs carry only the model fields that matter ({limit}, sometimes {api:{npm}}).
// expand() fills the rest from MODEL_BASE before calling v1 code.
const MODEL_BASE = {
  id: "test-model",
  providerID: "test",
  name: "Test",
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  capabilities: {
    toolcall: true,
    attachment: false,
    reasoning: false,
    temperature: true,
    interleaved: false,
    input: { text: true, image: false, audio: false, video: false, pdf: false },
    output: { text: true, image: false, audio: false, video: false, pdf: false },
  },
  api: { id: "test-model", url: "https://example.com", npm: "@ai-sdk/anthropic" },
  status: "active",
  options: {},
  headers: {},
  release_date: "2025-01-01",
}
const model = (limit, npm) => (npm ? { limit, api: { npm } } : { limit })
const expand = (value, key) => {
  if (Array.isArray(value)) return value.map((item) => expand(item))
  if (!value || typeof value !== "object") return value
  if (key === "model" && "limit" in value) return { ...MODEL_BASE, ...value, api: { ...MODEL_BASE.api, ...value.api } }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v, k)]))
}
const tok = (input, extra = {}) => ({ input, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, ...extra })

const cases = []
// A case runs on a clone, so that in-place mutation (strip) never changes the recorded input. `each(run)` records
// one case per input item, named `<name>/<index>`.
const add = async (name, fn, input, run) => {
  if (run.each) {
    for (const [index, item] of input.entries())
      cases.push({
        name: `${name}/${index}`,
        fn,
        input: item,
        output: (await run.each(expand(structuredClone(item)))) ?? null,
      })
    return
  }
  cases.push({ name, fn, input, output: (await run(expand(structuredClone(input)))) ?? null })
}
const each = (run) => ({ each: run })

const m200 = model({ context: 200_000, output: 32_000 })
const m400i200 = model({ context: 400_000, input: 200_000, output: 32_000 })
const m400i272 = model({ context: 400_000, input: 272_000, output: 128_000 })
const t75 = { compaction: { threshold_percent: 75 } }
const t80 = { compaction: { threshold_percent: 80 } }

// ---------- usable ----------
await add(
  "usable/no-input-limit",
  "usable",
  [
    { cfg: {}, model: m200 },
    { cfg: {}, model: model({ context: 200_000, output: 100_000 }), outputTokenMax: 8_000 },
    { cfg: {}, model: model({ context: 200_000, output: 100_000 }), outputTokenMax: 64_000 },
    { cfg: {}, model: model({ context: 40_000, output: 262_144 }) },
    { cfg: { compaction: { reserved: 5_000 } }, model: model({ context: 262_144, output: 262_144 }) },
    { cfg: {}, model: model({ context: 0, output: 32_000 }) },
  ],
  each(usable),
)
await add(
  "usable/with-input-limit",
  "usable",
  [
    { cfg: {}, model: m400i200 },
    { cfg: {}, model: model({ context: 400_000, input: 272_000, output: 8_000 }) },
    { cfg: { compaction: { reserved: 5_000 } }, model: m400i200 },
    { cfg: {}, model: m400i272 },
  ],
  each(usable),
)

// ---------- isOverflow (post-step safety check; threshold_percent is ignored here) ----------
await add(
  "isOverflow/default-boundary",
  "isOverflow",
  [
    { cfg: {}, model: m200, tokens: tok(167_999) },
    { cfg: {}, model: m200, tokens: tok(168_000) },
  ],
  each(isOverflow),
)
await add(
  "isOverflow/input-limit-boundary",
  "isOverflow",
  [
    { cfg: {}, model: m400i200, tokens: tok(179_999) },
    { cfg: {}, model: m400i200, tokens: tok(180_000) },
  ],
  each(isOverflow),
)
await add(
  "isOverflow/threshold-ignored-post-step",
  "isOverflow",
  [
    { cfg: t75, model: m200, tokens: tok(160_000) },
    { cfg: { compaction: { threshold_percent: 10 } }, model: m200, tokens: tok(167_999) },
    { cfg: t75, model: m200, tokens: tok(168_000) },
  ],
  each(isOverflow),
)
await add(
  "isOverflow/cache-and-reasoning-counted",
  "isOverflow",
  [
    {
      cfg: {},
      model: m200,
      tokens: tok(100_000, { output: 2_000, reasoning: 1_000, cache: { read: 60_000, write: 4_999 } }),
    },
    {
      cfg: {},
      model: m200,
      tokens: tok(100_000, { output: 2_000, reasoning: 1_000, cache: { read: 60_000, write: 5_000 } }),
    },
  ],
  each(isOverflow),
)
await add(
  "isOverflow/total-fallback",
  "isOverflow",
  [
    { cfg: {}, model: m200, tokens: tok(80_000, { total: 250_000 }) },
    { cfg: {}, model: m200, tokens: tok(0, { total: 168_000 }) },
    { cfg: {}, model: m200, tokens: tok(0, { total: 167_999 }) },
  ],
  each(isOverflow),
)
await add(
  "isOverflow/disabled",
  "isOverflow",
  [
    { cfg: { compaction: { auto: false } }, model: m200, tokens: tok(190_000) },
    { cfg: {}, model: model({ context: 0, output: 32_000 }), tokens: tok(1_000_000) },
  ],
  each(isOverflow),
)

// ---------- count / baseline ----------
await add(
  "count",
  "KiloSessionOverflow.count",
  [tok(10, { output: 20, reasoning: 30, cache: { read: 40, write: 50 }, total: 999 }), tok(0, { total: 777 }), tok(0)],
  each(KiloSessionOverflow.count),
)
await add(
  "baseline",
  "KiloSessionOverflow.baseline",
  [
    { assistant: { id: "msg-1" }, finished: { id: "msg-1", tokens: tok(150_000) } },
    { assistant: { id: "msg-2" }, finished: { id: "msg-1", tokens: tok(150_000) } },
    { assistant: { id: "msg-1" } },
    { assistant: { id: "msg-1" }, finished: { id: "msg-1", summary: true, tokens: tok(150_000) } },
    { assistant: { id: "msg-1" }, finished: { id: "msg-1", tokens: tok(0, { output: 100 }) } },
    {
      assistant: { id: "msg-1" },
      finished: { id: "msg-1", tokens: tok(0, { output: 100, cache: { read: 50, write: 0 } }) },
    },
  ],
  each((i) => KiloSessionOverflow.baseline(i) ?? null),
)

// ---------- threshold_percent: limit / enabled ----------
await add(
  "threshold/limit-and-enabled",
  "usable -> KiloSessionOverflow.limit, KiloSessionOverflow.enabled",
  [
    { cfg: {}, model: m200 },
    { cfg: { compaction: { threshold_percent: null } }, model: m200 },
    { cfg: t75, model: m200 },
    { cfg: { compaction: { threshold_percent: 95 } }, model: m200 },
    { cfg: { compaction: { threshold_percent: 33.3 } }, model: model({ context: 200_001, output: 32_000 }) },
    { cfg: t75, model: m400i272 },
    { cfg: { compaction: { threshold_percent: 50 } }, model: m400i272 },
    { cfg: { compaction: { auto: false, threshold_percent: 75 } }, model: m200 },
    { cfg: t75, model: model({ context: 0, output: 32_000 }) },
  ],
  each((i) => {
    const u = usable(i)
    return { usable: u, limit: KiloSessionOverflow.limit({ ...i, usable: u }), enabled: KiloSessionOverflow.enabled(i) }
  }),
)
await add(
  "threshold/config-validation",
  "Schema.decodeUnknownExit(ConfigV1.Info)({compaction:{threshold_percent}})",
  [75, 100, 0.5, null, 0, 100.5, -1, "75"],
  each((value) =>
    Exit.isSuccess(Schema.decodeUnknownExit(ConfigV1.Info)({ compaction: { threshold_percent: value } })),
  ),
)

// ---------- shouldCompact (preflight), stats variant ----------
const sc = (i) => KiloSessionOverflow.shouldCompact({ ...i, usable: usable(i) })
await add(
  "shouldCompact/threshold75-boundary",
  "KiloSessionOverflow.shouldCompact",
  [
    { cfg: t75, model: m200, tokens: 149_999, tail: 0, continuation: false },
    { cfg: t75, model: m200, tokens: 150_000, tail: 0, continuation: false },
  ],
  each(sc),
)
await add(
  "shouldCompact/threshold80-reported-boundary",
  "KiloSessionOverflow.shouldCompact",
  [
    { cfg: t80, model: m200, tokens: 10_000, tail: 0, continuation: false, reported: 159_999 },
    { cfg: t80, model: m200, tokens: 10_000, tail: 0, continuation: false, reported: 160_000 },
  ],
  each(sc),
)
await add(
  "shouldCompact/projection",
  "KiloSessionOverflow.shouldCompact",
  [
    { cfg: t80, model: m200, tokens: 100, tail: 4_000, overhead: 999, continuation: false, reported: 155_000 },
    { cfg: t80, model: m200, tokens: 100, tail: 4_000, overhead: 1_000, continuation: false, reported: 155_000 },
    { cfg: t80, model: m200, tokens: 170_000, tail: 1_000, continuation: false, reported: 0 },
    { cfg: t80, model: m200, tokens: 170_000, tail: 0, continuation: false, reported: 1_000 },
  ],
  each(sc),
)
await add(
  "shouldCompact/guards",
  "KiloSessionOverflow.shouldCompact",
  [
    { cfg: t80, model: m200, tokens: 500_000, tail: 0, continuation: true, reported: 500_000 },
    { cfg: {}, model: m200, tokens: 500_000, tail: 0, continuation: false },
    {
      cfg: { compaction: { auto: false, threshold_percent: 80 } },
      model: m200,
      tokens: 500_000,
      tail: 0,
      continuation: false,
    },
  ],
  each(sc),
)
await add(
  "shouldCompact/input-model-usable-wins",
  "KiloSessionOverflow.shouldCompact",
  [
    { cfg: t80, model: m400i272, tokens: 1_000, tail: 0, continuation: false, reported: 251_999 },
    { cfg: t80, model: m400i272, tokens: 1_000, tail: 0, continuation: false, reported: 252_000 },
  ],
  each(sc),
)

// ---------- measure + shouldCompact, payload variant ----------
const tiny = model({ context: 500, output: 50 })
const t50 = { compaction: { threshold_percent: 50 } }
const payload = [
  { role: "system", content: "s".repeat(200) },
  { role: "user", content: "u".repeat(400) },
  { role: "assistant", content: [{ type: "text", text: "ok" }] },
  {
    role: "user",
    content: [
      { type: "text", text: "describe" },
      { type: "file", mediaType: "image/png", data: "x".repeat(400) },
    ],
  },
]
const tools = {
  search: { description: "search files", inputSchema: { type: "object", properties: { q: { type: "string" } } } },
}
await add(
  "measure/system-media-tools",
  "KiloSessionOverflow.measure",
  { messages: payload, tools },
  KiloSessionOverflow.measure,
)
await add(
  "measure/encrypted-reasoning-continuation",
  "KiloSessionOverflow.measure",
  {
    messages: [
      { role: "user", content: "run it" },
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "thinking",
            providerOptions: { openai: { itemId: "rs_1", reasoningEncryptedContent: "e".repeat(400) } },
          },
          { type: "tool-call", toolCallId: "call-1", toolName: "bash", input: { cmd: "pwd" } },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call-1", toolName: "bash", output: { type: "text", value: "/tmp" } },
        ],
      },
    ],
    tools: {},
  },
  KiloSessionOverflow.measure,
)
await add(
  "shouldCompact/payload",
  "KiloSessionOverflow.shouldCompact (messages+tools input)",
  [
    { cfg: t50, model: tiny, messages: payload, tools },
    { cfg: t50, model: tiny, messages: payload.slice(1), tools: {} },
    { cfg: t50, model: tiny, messages: payload.slice(1), tools: {}, reported: 205 },
    { cfg: t50, model: tiny, messages: payload.slice(1), tools: {}, reported: 206 },
  ],
  each((i) => ({
    limit: KiloSessionOverflow.limit({ ...i, usable: usable(i) }),
    stats: KiloSessionOverflow.measure(i),
    result: sc(i),
  })),
)

// ---------- chunked compaction ----------
const chunkModel = model({ context: 10_000, output: 1_000 }, "@ai-sdk/openai")
await add(
  "chunks/needed-and-budget",
  "KiloCompactionChunks.needed, KiloCompactionChunks.budget",
  [
    { cfg: { compaction: { reserved: 1_000 } }, model: chunkModel, tokens: 6_153 },
    { cfg: { compaction: { reserved: 1_000 } }, model: chunkModel, tokens: 6_154 },
    { cfg: {}, model: model({ context: 10_000, output: 8_000 }), tokens: 5_000, outputTokenMax: 512 },
    { cfg: {}, model: model({ context: 1_500, output: 1_000 }), tokens: 10 },
    { cfg: {}, model: m400i272, tokens: 150_000 },
  ],
  each((i) => ({ needed: KiloCompactionChunks.needed(i), budget: KiloCompactionChunks.budget(i) })),
)
await add(
  "chunks/eligible",
  "KiloCompactionChunks.eligible",
  [
    { result: "compact" },
    { result: "stop", error: { name: "ContextOverflowError", data: { message: "too long" } } },
    { result: "stop", error: { name: "APIError", data: { message: "boom", isRetryable: false } } },
    { result: "stop" },
    { result: "continue" },
  ],
  each(KiloCompactionChunks.eligible),
)

const sid = "ses_fixture"
const ref = { providerID: "test", modelID: "test-model" }
const userMsg = (id, created, text) => ({
  info: { id, role: "user", sessionID: sid, agent: "build", model: ref, time: { created } },
  parts: [{ id: `prt_${id}`, messageID: id, sessionID: sid, type: "text", text }],
})
const asstMsg = (id, parentID, created, text) => ({
  info: {
    id,
    role: "assistant",
    sessionID: sid,
    parentID,
    mode: "build",
    agent: "build",
    path: { cwd: "/w", root: "/w" },
    cost: 0,
    tokens: tok(0),
    modelID: "test-model",
    providerID: "test",
    time: { created, completed: created + 1 },
    finish: "stop",
  },
  parts: [{ id: `prt_${id}`, messageID: id, sessionID: sid, type: "text", text }],
})
const estimate = async (messages, mdl) => {
  const msgs = await Effect.runPromise(
    MessageV2.toModelMessagesEffect(messages, mdl, { stripMedia: true, toolOutputMaxChars: 2_000 }),
  )
  return Math.max(0, Math.round(JSON.stringify(msgs).length / 4))
}
const history = [
  userMsg("msg_01", 1, "a".repeat(200)),
  asstMsg("msg_02", "msg_01", 2, "b".repeat(200)),
  userMsg("msg_03", 3, "c".repeat(600)),
  asstMsg("msg_04", "msg_03", 4, "d".repeat(100)),
  userMsg("msg_05", 5, "e".repeat(40)),
]
await add(
  "chunks/split-small-history",
  "KiloCompactionChunks.split (sizes 150, 250, 1000)",
  { messages: history, model: chunkModel, sizes: [150, 250, 1_000] },
  async (i) => ({
    // informational: v1 estimate = Token.estimate(JSON.stringify(toModelMessages(..., {stripMedia, toolOutputMaxChars: 2000})))
    perMessageEstimate: await Promise.all(i.messages.map((m) => estimate([m], i.model))),
    plans: await Promise.all(
      i.sizes.map(async (size) => {
        const chunks = await Effect.runPromise(
          KiloCompactionChunks.split({ messages: i.messages, model: i.model, size }),
        )
        return {
          size,
          chunks: chunks.map((c) => ({ index: c.index, ids: c.messages.map((m) => m.info.id) })),
          chunkEstimate: await Promise.all(chunks.map((c) => estimate(c.messages, i.model))),
        }
      }),
    ),
  }),
)
await add(
  "chunks/split-oversized-single-message",
  "KiloCompactionChunks.split",
  {
    messages: [userMsg("msg_big", 1, "z".repeat(400)), userMsg("msg_small", 2, "y")],
    model: chunkModel,
    size: 50,
  },
  async (i) =>
    (await Effect.runPromise(KiloCompactionChunks.split(i))).map((c) => ({
      index: c.index,
      ids: c.messages.map((m) => m.info.id),
    })),
)

// ---------- payload recovery ----------
await add(
  "payload/matches",
  "KiloCompactionPayloadRecovery.matches",
  [
    {
      name: "ContextOverflowError",
      data: {
        message: "Request Entity Too Large",
        responseBody: "Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE",
      },
    },
    {
      name: "APIError",
      data: { message: "Bad request", statusCode: 413, isRetryable: false, responseBody: "function_payload_too_large" },
    },
    { name: "APIError", data: { message: "request entity too large", isRetryable: false } },
    { name: "APIError", data: { message: "Rate limit exceeded", statusCode: 429, isRetryable: true } },
    { name: "ContextOverflowError", data: { message: "prompt is too long: 210000 tokens > 200000 maximum" } },
    { name: "UnknownError", data: { message: "Request Entity Too Large" } },
    null,
  ],
  each((e) => KiloCompactionPayloadRecovery.matches(e ?? undefined)),
)
await add(
  "payload/fromError-then-matches",
  "MessageV2.fromError(new APICallError(...), {providerID:'kilo'}) -> matches",
  [
    {
      message: "Request Entity Too Large",
      statusCode: 413,
      responseBody: "Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE",
      url: "https://api.kilo.ai/api/openrouter/responses",
    },
    {
      message: "Too Many Requests",
      statusCode: 429,
      responseBody: "slow down",
      url: "https://api.kilo.ai/api/openrouter/responses",
    },
  ],
  each((i) => {
    const error = MessageV2.fromError(
      new APICallError({
        message: i.message,
        url: i.url,
        requestBodyValues: {},
        statusCode: i.statusCode,
        responseHeaders: { "content-type": "text/plain" },
        responseBody: i.responseBody,
        isRetryable: false,
      }),
      { providerID: "kilo" },
    )
    return { name: error.name, message: error.data.message, matches: KiloCompactionPayloadRecovery.matches(error) }
  }),
)
await add(
  "payload/prompt",
  "KiloCompactionPayloadRecovery.prompt",
  "<conversation>...</conversation>",
  KiloCompactionPayloadRecovery.prompt,
)

const part = (messageID, n, rest) => ({ id: `prt_${messageID}_${n}`, messageID, sessionID: sid, ...rest })
const toolState = (status, extra) => ({
  status,
  input: { cmd: "ls" },
  title: "Bash",
  metadata: {},
  time: { start: 1, end: 2 },
  ...extra,
})
await add(
  "payload/strip",
  "KiloCompactionPayloadRecovery.strip (Date.now stubbed to 1700000000000; output = parts passed to update, in order)",
  [
    {
      info: { id: "msg_u1", role: "user", sessionID: sid, agent: "build", model: ref, time: { created: 1 } },
      parts: [
        part("msg_u1", 1, { type: "text", text: "see attached" }),
        part("msg_u1", 2, {
          type: "file",
          mime: "image/png",
          filename: "screen.png",
          url: "data:image/png;base64,abc",
        }),
        part("msg_u1", 3, { type: "file", mime: "application/pdf", url: "data:application/pdf;base64,abc" }),
        part("msg_u1", 4, {
          type: "file",
          mime: "text/plain",
          filename: "notes.txt",
          url: "data:text/plain;base64,abc",
        }),
      ],
    },
    {
      info: {
        id: "msg_a1",
        role: "assistant",
        sessionID: sid,
        parentID: "msg_u1",
        mode: "build",
        agent: "build",
        path: { cwd: "/w", root: "/w" },
        cost: 0,
        tokens: tok(0),
        modelID: "test-model",
        providerID: "test",
        time: { created: 2 },
      },
      parts: [
        part("msg_a1", 1, {
          type: "tool",
          callID: "c1",
          tool: "bash",
          state: toolState("completed", { output: "big output" }),
        }),
        part("msg_a1", 2, {
          type: "tool",
          callID: "c2",
          tool: "bash",
          state: toolState("completed", { output: "old", time: { start: 1, end: 2, compacted: 5 } }),
        }),
        part("msg_a1", 3, { type: "tool", callID: "c3", tool: "bash", state: toolState("error", { error: "failed" }) }),
        part("msg_a1", 4, {
          type: "tool",
          callID: "c4",
          tool: "bash",
          state: { status: "running", input: { cmd: "ls" }, time: { start: 1 } },
        }),
        part("msg_a1", 5, { type: "text", text: "done" }),
      ],
    },
  ],
  async (messages) => {
    const updated = []
    await Effect.runPromise(
      KiloCompactionPayloadRecovery.strip({
        messages,
        update: (p) => Effect.sync(() => (updated.push(structuredClone(p)), p)),
      }),
    )
    return updated
  },
)

// ---------- compaction attempt cap ----------
await add(
  "cap/guardCompactionAttempt",
  "KiloSessionPrompt.guardCompactionAttempt (+ MAX_COMPACTION_ATTEMPTS)",
  [0, 2, 3],
  each((attempts) => {
    const closeReasons = new Map()
    const message = {}
    const r = KiloSessionPrompt.guardCompactionAttempt({ sessionID: sid, attempts, closeReasons, message })
    return {
      max: KiloSessionPrompt.MAX_COMPACTION_ATTEMPTS,
      exhausted: r.exhausted,
      error: r.error ?? null,
      closeReason: closeReasons.get(sid) ?? null,
      message,
    }
  }),
)

await write({
  sources: [
    "packages/opencode/src/session/overflow.ts",
    "packages/opencode/src/kilocode/session/overflow.ts",
    "packages/opencode/src/kilocode/session/compaction-chunks.ts",
    "packages/opencode/src/kilocode/session/compaction-payload-recovery.ts",
    "packages/opencode/src/kilocode/session/prompt.ts",
    "packages/opencode/src/session/compaction.ts",
    "packages/opencode/src/provider/transform.ts",
    "packages/core/src/v1/config/config.ts",
  ],
  constants: {
    MODEL_BASE,
    NOW,
    MAX_COMPACTION_ATTEMPTS: KiloSessionPrompt.MAX_COMPACTION_ATTEMPTS,
    note: "A `model` in an input carries only `limit` (and sometimes `api.npm`); v1 ran it merged over MODEL_BASE (api merged too). strip ran with Date.now() fixed to NOW. measure and split outputs depend on the v1 message serialization.",
  },
  cases,
})
process.exit(0)
