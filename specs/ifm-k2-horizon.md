# IFM K2 Horizon — Agent Implementation Spec

Single-file reference for implementing full K2 Horizon support in Kilo Code.
Source: https://docs.ifm.ai (pages: introduction, model-catalog, reasoning,
custom-function-calling, streaming, structured-output, multi-turn,
session-routing, chat-completions, transcription, limits, errors, deprecation,
migration, quickstart, harness). Captured 2026-09-26. IFM marks parts of the
docs as work in progress — figures, limits, and commands are provisional and
may change before launch.

## 1. Platform facts

- IFM = Institute of Foundation Models (research institute of MBZUAI, Abu Dhabi).
- Hosted API base URL: `https://api.ifm.ai/v1` — OpenAI-compatible. All IFM
  models share this one base URL.
- Auth: `Authorization: Bearer <IFM_API_KEY>` header on every request. API keys
  look like `IFM-xf...` / `sk-ifm-...`.
- K2 Horizon is the flagship: frontier reasoning series built for agentic tool
  use and long-horizon tasks. Apache 2.0 weights license. Pre-train data cutoff
  December 2025.
- Flagship model id: `IFM/K2-Horizon-375B-A23B` (375B sparse MoE) — the only
  K2 Horizon size served on the hosted API.

## 2. Model catalog

| Model | Architecture | Context | Hosted API | Notes |
|---|---|---|---|---|
| `IFM/K2-Horizon-375B-A23B` | Sparse MoE | 512K | yes | Frontier reasoning, long-horizon agents |
| `IFM/K2-Horizon-MoVA-36B-A4B` | MoVA + MoE | 512K | no | Weights only |
| `IFM/K2-Horizon-32B` | Dense decoder-only | 512K | no | Weights only |
| `IFM/K2-Horizon-7B` | Dense decoder-only | 512K | no | Weights only |
| `IFM/K2-Horizon-3.7B` | Dense decoder-only | 512K | no | Weights only |
| `IFM/K2-Horizon-0.9B` | Dense decoder-only | 128K | no | Local dev, eval dry runs |
| `IFM/Jais-ASR` | Speech-to-text | — | yes (announced "coming soon" on weights) | Transcription endpoint |
| `K2-Think-V2` (70B, 128K) | Reasoning | 128K | deprecating | Ends 3 Oct 2026 |
| `Jais-2-70B-Chat` / `Jais-2-8B-Chat` | Dense | 8K | no | Left hosted API 21 Aug 2026 |
| `IFM/Jais-3-*` | Mirrors K2 Horizon sizes, Arabic-specialized | 512K | `IFM/Jais-3-MoVA-36B-A4B` hosted; weights coming soon | Arabic + 19 dialects, Arabic OCR |

Every K2 Horizon size is open weight (Hugging Face collection `IFM/K2-Horizon`).
The 375B MoE is the one served on the hosted API.

## 3. Lifecycle and deprecation

- `MBZUAI-IFM/K2-Think-V2` deprecated as of 3 September 2026; hosted access
  ends 3 October 2026. Replacement: `IFM/K2-Horizon-375B-A23B`. Weights remain
  on Hugging Face.
- Deprecated base URLs (3 September 2026): `api.k2think.ai/v1` →
  `api.ifm.ai/v1`; `api.jaischat.ai/v1` (no replacement).
- Timeline: 3 Sep 2026 deprecation starts, responses carry warning headers,
  legacy base URLs redirect to `api.ifm.ai`; 3 Sep – 3 Oct 2026 grace period
  with automatic redirects; 3 Oct 2026 hosted access ends, requests return 410
  `deprecated_model_error` carrying the migration-guide URL in the body.
- Migration deltas from K2 V2 to K2 Horizon: context window 128K → 512K;
  assistant turns now carry `reasoning_content` that must be replayed verbatim;
  tool format params `tool_presentation_format` and `tool_call_format` set to
  `"xml"` (assistant tool turns keep both `tool_calls` and reasoning);
  recommended sampling temperature 1.0 and top_p 0.95; replayed reasoning
  counts as prompt tokens, so long threads consume the daily cap faster than
  the visible transcript suggests.

## 4. Chat Completions API

`POST https://api.ifm.ai/v1/chat/completions` — fully compatible with the
OpenAI Chat Completions API.

### Parameters

| Parameter | Type | Status | Notes |
|---|---|---|---|
| `model` | string | Required | e.g. `IFM/K2-Horizon-375B-A23B` |
| `messages` | array | Required | system / user / assistant / tool roles. Text content only. |
| `reasoning_effort` | string | Extended | `"low"` · `"medium"` · `"high"`, default `"high"`. Passed via `chat_template_kwargs`, not top-level. |
| `temperature` | float | Supported | 0–2, default 0.7. Use ≤0.3 for agentic workloads. Migration page recommends 1.0 for K2 Horizon. |
| `top_p` | float | Supported | 0–1, default 1. Prefer this or temperature, not both. Migration page recommends 0.95 for K2 Horizon. |
| `max_tokens` | int | Supported | Cap on completion length. Defaults to remaining context. |
| `stop` | string \| array | Supported | Up to 4 stop sequences. |
| `seed` | int | Supported | Best-effort determinism for identical requests. |
| `stream` | bool | Supported | SSE streaming. |
| `tools` / `tool_choice` | array \| string | Supported | Standard OpenAI function schema — no changes needed. |
| `response_format` | object | Extended | `{ "type": "json_object" }` for guaranteed JSON; `json_schema` for structured output. |
| `frequency_penalty` | float | Accepted | No effect. |
| `logprobs` | bool | Accepted | Not returned. |

K2 Horizon also accepts the two format parameters `tool_presentation_format`
and `tool_call_format` (both `"xml"`) — see §7.

### Response

```json
{
  "id": "chatcmpl-acd8436fe38e4520",
  "model": "IFM/K2-Horizon-375B-A23B",
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "Hello! Is there anything I can help you with today?",
      "reasoning_content": "The user just says hello, no request. Respond warmly and…",
      "reasoning": "The user just says hello, no request. Respond warmly and…",
      "tool_calls": []
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 11,
    "completion_tokens": 214,
    "total_tokens": 225,
    "prompt_tokens_details": { "cached_tokens": 0 },
    "completion_tokens_details": { "reasoning_tokens": 184 }
  }
}
```

- `reasoning_content` is the canonical reasoning field (matches vLLM and
  SGLang). `reasoning` is a mirror with the same value, kept for older clients.
  Send either; sending both is harmless.
- `usage.completion_tokens_details.reasoning_tokens` reports thinking tokens.

## 5. Reasoning

- Thinking budget is set with `reasoning_effort` — one of `low`, `medium`, or
  `high` — passed through `chat_template_kwargs` in the request body (not as a
  top-level parameter):

```json
{
  "model": "IFM/K2-Horizon-375B-A23B",
  "messages": [{ "role": "user", "content": "hello" }],
  "chat_template_kwargs": { "reasoning_effort": "high" }
}
```

- Use `high`. IFM tunes and evaluates K2 Horizon at high effort and recommends
  it for production. `low` and `medium` are supported for latency- or
  cost-sensitive traffic — validate on your own evals first.
- Each effort level closes the trace with its own token:

| Effort | Closing token |
|---|---|
| low | `<ifm|think_faster>` |
| medium | `<ifm|think_fast>` |
| high (recommended) | `<ifm|think>` |

- The trace returns in `reasoning_content`, separate from `content`.

## 6. Multi-turn conversations

- The model is stateless: each request must carry the full conversation
  history.
- Append every assistant message back into `messages` exactly as returned
  (both `content` and `reasoning_content`), then append the next user turn.
- `""` (empty string) is a valid `reasoning_content` value — keep it rather
  than dropping the field or sending `null`. Conversations break as soon as a
  model turn returns an empty reasoning trace and the field is dropped.
- The replay rule applies uniformly to plain replies, tool calls, and streamed
  responses. Streamed turns must be assembled from deltas before being
  appended (see §8).

## 7. Custom function calling

- Tool calling uses the standard OpenAI tool schema — existing tool definitions
  work unchanged. The application implements and executes the function; the
  interface (name, description, JSON Schema parameters) is defined in the
  `tools` array; K2 Horizon selects the function and generates arguments but
  never executes it.

```json
{
  "type": "function",
  "function": {
    "name": "lookup_order_status",
    "description": "Current status of a customer order.",
    "parameters": {
      "type": "object",
      "properties": { "order_id": { "type": "string" } },
      "required": ["order_id"]
    }
  }
}
```

- Tool loop: the model answers with `finish_reason: "tool_calls"` and empty
  `content`. Execute the function, append the result as a `tool` message with
  the matching `tool_call_id`, and re-send — looping until
  `finish_reason: "stop"`.
- `tool_choice` values: `"auto"` (default when tools present — model decides),
  `"none"` (tools visible but never called), `"required"` (must call at least
  one tool), or `{"type": "function", …}` (forces one named function; the
  model still chooses arguments).
- The model may return several entries in `tool_calls` in a single turn — each
  one needs its own `tool` message back.
- Assistant tool turns keep both `tool_calls` and `reasoning_content`; the
  reasoning still must be replayed.
- K2 Horizon format parameters — set both to `"xml"` when doing agentic
  tool-call workloads (from the migration page):

```python
resp = client.chat.completions.create(
    model="IFM/K2-Horizon-375B-A23B",
    messages=messages,
    tools=tools,
    extra_body={
        "tool_presentation_format": "xml",
        "tool_call_format": "xml",
    },
)
```

Responses keep the usual OpenAI shape (`tool_calls` with
`finish_reason: "tool_calls"`), so parsing code does not change. Note: the
hosted tool-calling page examples omit these params — validate against the
live endpoint whether they are required for hosted traffic or only for
self-hosted serving.

## 8. Streaming

- Set `stream: true` to receive the response incrementally as server-sent
  events in the OpenAI-compatible chunk schema. Existing SDK streaming code
  works unchanged.
- Reasoning and content arrive as **separate deltas** — buffer each on its own,
  then append the finished turn when the stream ends:

```python
content, reasoning = "", ""
for chunk in stream:
    delta = chunk.choices[0].delta
    reasoning += getattr(delta, "reasoning_content", None) or ""
    content += getattr(delta, "content", None) or ""

messages.append({"role": "assistant", "content": content, "reasoning_content": reasoning})
```

- Tool calls stream too, and `arguments` arrives in fragments across many
  chunks. Accumulate fragments per `tool_calls[i].index` and only parse the
  JSON once the stream has finished — a partial fragment is almost never valid
  JSON on its own.
- The last content chunk carries `finish_reason` — `"stop"`, `"length"`, or
  `"tool_calls"` — followed by the `[DONE]` sentinel. Treat a stream that ends
  without a `finish_reason` as truncated and retry it; do not append a
  half-finished turn to history.
- Streams cannot be resumed. If the connection drops mid-generation, re-send
  the request from the last complete turn. Sending the same `X-Session-ID`
  makes the retry land on the compute node that still holds the prefix.

## 9. Structured output

- Constrain the reply with `response_format`:
  - `{ "type": "json_object" }` guarantees the reply parses as JSON but says
    nothing about shape. Describe the fields in the prompt as well — the
    constraint enforces syntax, not structure.
  - `{ "type": "json_schema", "json_schema": { "name": ..., "strict": true,
    "schema": ... } }` pins the exact shape. Decoding is constrained to the
    schema, so the reply validates by construction and defensive parsing can
    be skipped.
- Keep schemas shallow and name fields the way you would in a prompt — deeply
  nested or cryptically named schemas cost tokens and degrade the content of
  the answer even though it stays valid.
- The constraint applies to `content` only. `reasoning_content` is free-form
  prose and is never JSON — parse the two fields separately, and keep
  replaying the trace across turns.
- Failure modes: a schema the model cannot satisfy usually surfaces as a
  truncated reply with `finish_reason: "length"` rather than an error — raise
  `max_tokens`, then simplify the schema. Unsupported JSON Schema keywords are
  rejected at request time with a 400.

## 10. Session routing

- Hosted requests are load-balanced across many compute nodes. Sending a
  session identifier keeps a conversation on the node that already holds its
  KV cache, so the shared prefix is not recomputed on every turn.
- Set the `X-Session-ID` header to a value that is stable for the life of one
  conversation or agent run:

```bash
curl https://api.ifm.ai/v1/chat/completions \
  -H "Authorization: Bearer $IFM_API_KEY" \
  -H "X-Session-ID: conv_8f2c14ab" \
  -H "Content-Type: application/json" \
  -d '{"model": "IFM/K2-Horizon-375B-A23B", "messages": [...]}'
```

- Value rules: stable per conversation (turn N+1 must reach the node that
  served turn N); opaque and unguessable — use a random ID you mint, never an
  email, user name, or raw account ID; never shared across users; new ID per
  agent run (long-lived agent loops reuse a large prefix; a fresh run has a
  fresh prefix).
- This is a best-effort latency and efficiency optimization. Results are
  identical with or without the header — no state is stored on the node
  between requests, nothing about the conversation is retained server-side.
  Affinity can break at any time (nodes added, drained, restarted; cache
  eviction under memory pressure). Treat a cache hit as a bonus, never a
  substitute for sending the full conversation history on each request.
- Pays off most: long multi-turn chats, agent loops that resend a growing tool
  transcript, workloads with a large shared system prompt.
- Under the hood: the hosted API balances traffic with the vLLM Router using
  its `consistent_hash` policy, which routes requests carrying the same
  session identifier to the same backend worker.

## 11. Limits

- Every API key gets **10,000,000 tokens per day**, counting prompt and
  completion tokens together. The counter resets at 00:00 UTC. Requests past
  the cap return 429 `rate_limit_error` until the next reset. Scope: per API
  key.
- Per-minute request and token guards also run on the platform to protect
  shared capacity. They are set well above normal application traffic and are
  not published — build against the daily cap, and handle 429 responses with
  the `Retry-After` header.

| Header | Meaning |
|---|---|
| `x-ratelimit-limit-tokens` | Current allowance applied by the platform guard. Informational — not a published quota. |
| `x-ratelimit-remaining-tokens` | Tokens left against that guard in the current window. |
| `x-ratelimit-limit-tokens-daily` | Daily token cap (10,000,000), resetting at 00:00 UTC. |
| `x-ratelimit-remaining-tokens-daily` | Tokens left in today's allowance. |
| `x-ratelimit-reset-tokens` | Seconds until the guard window refills. |
| `Retry-After` | Seconds to wait before retrying (present on 429s). |

## 12. Errors

Every error carries an HTTP status and a JSON body with a stable `error.type`.
Branch on type, not on the message text — messages may change.

| Status | Type | Notes | Retry |
|---|---|---|---|
| 400 | `invalid_request_error` | Malformed JSON, missing required field, or an invalid parameter value. Fix the payload. | No |
| 401 | `authentication_error` | Missing or invalid API key. | No |
| 403 | `permission_error` | Key valid but not entitled to this model, endpoint, or region. | No |
| 404 | `not_found_error` | Unknown model ID or endpoint path. | No |
| 408 | `timeout_error` | Server-side time limit exceeded. Shorten prompt or reduce `max_tokens`. | Backoff |
| 410 | `deprecated_model_error` | Model reached its sunset date. Body carries the migration-guide URL. | No |
| 413 | `request_too_large` | Body exceeds size limit, or prompt exceeds the model context window. | No |
| 422 | `validation_error` | Semantically invalid request — e.g. malformed tool schema or unsupported parameter combination. (Chat-completions page also documents 422 `context_length_exceeded` when prompt + max_tokens exceeds the 512K window.) | No |
| 429 | `rate_limit_error` | Rate or quota exceeded. Wait `Retry-After`, then exponential backoff. | Backoff |
| 499 | `request_cancelled` | Client disconnected before completion. Not billed. | Yes |
| 500 | `api_error` | Unexpected internal error. Exponential backoff with jitter. | Backoff |
| 502 / 504 | `upstream_error` | Gateway or upstream inference node failed or timed out. Transient. | Backoff |
| 503 | `service_unavailable` | Temporarily unable to serve (deploy or capacity event). | Backoff |
| 529 | `overloaded_error` | Service at capacity. Back off aggressively with jitter. | Backoff |

Error body shape:

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "missing_required_parameter",
    "param": "messages",
    "message": "Field 'messages' is required."
  }
}
```

429 example: status 429 with `Retry-After: 37` header and
`"error": { "type": "rate_limit_error", "code": "token_rate_limit", "message":
"Per-minute token budget exhausted." }`.

## 13. Transcriptions API

`POST https://api.ifm.ai/v1/audio/transcriptions` — compatible with the OpenAI
audio transcription API; existing clients work by changing base URL and key.
Auth, quotas, and error envelopes are the same as chat completions. Model id:
`IFM/Jais-ASR`.

Request body is multipart/form-data:

| Parameter | Type | Status | Notes |
|---|---|---|---|
| `file` | file | Required | Audio file as multipart form data. |
| `model` | string | Required | e.g. `IFM/Jais-ASR`. |
| `language` | string | Optional | Language hint. Omitting it is recommended. |
| `prompt` | string | Optional | Spelling hint for names, terminology, register. |
| `response_format` | string | Optional | `json` (default), `text`, `verbose_json`, `srt`, or `vtt`. |
| `timestamp_granularities` | string[] | Optional | `segment` and/or `word`. Requires `verbose_json`. |
| `temperature` | number | Optional | 0–1. Defaults to 0. |

Response (default `json` carries `text` and the detected-language `tag`;
`segments` and word timings require `verbose_json`):

```json
{
  "task": "transcribe",
  "tag": "ar",
  "duration": 12.48,
  "text": "...",
  "segments": [{ "id": 0, "start": 0.0, "end": 4.12, "text": "..." }],
  "usage": { "audio_seconds": 12.48 }
}
```

- Language detection: leave `language` unset — the model identifies the spoken
  language and returns the label in `tag`. Set `language` only when certain of
  the input; a wrong hint degrades accuracy even though `tag` still reports
  the detected language.
- Supported formats: FLAC, MP3, MP4, MPEG, MPGA, M4A, OGG (ogg/oga), WAV (PCM
  16/24-bit), WEBM. Each request is capped at **30 seconds** of audio; split
  longer recordings on silence and transcribe parts in sequence.

## 14. Tool and harness behavior (context for agent tool design)

- K2 Horizon speaks the standard Chat Completions tool-calling format — nothing
  proprietary; every capability maps onto existing tools.
- Web search: return results as compact JSON with `title` / `url` / `snippet`
  triples. K2 Horizon was trained on that shape — richer payloads work but
  this shape converges fastest. Reference providers: SearXNG (self-hosted, no
  key), Tavily, Brave Search.
- File I/O: the model was trained to emit structured file-writing arguments
  (e.g. sections for .docx writes) — let it pass structured objects rather
  than one raw string; output formatting becomes deterministic.
- Capability → tool map: web search (Tavily/SearXNG/Brave/Serper), read/write
  .docx (python-docx), .xlsx (openpyxl/pandas), .pdf (pypdf/pdfplumber), HTML
  generation (single-file static pages; validate with a linter), orchestration
  loop (LangGraph/CrewAI/OpenAI Agents SDK runner).
- The `horizon-agent-tools` package is a convenience, not a requirement.

## 15. Self-hosting

K2 Horizon models can be self-hosted with SGLang or vLLM (vLLM 0.30.0 or
later). Required vLLM flags for K2 Horizon:

```bash
vllm serve IFM/K2-Horizon-375B-A23B \
  --trust-remote-code \
  --reasoning-parser k2_horizon \
  --enable-auto-tool-choice --tool-call-parser k2_horizon \
  --chat-template-content-format string
```

- `--chat-template-content-format string` is **required** — without it vLLM
  misreads the K2 Horizon chat template and sends user messages to the model
  empty.
- `IFM_MODEL` must match the name vLLM serves (the id it was started with); if
  starting from a local path add `--served-model-name IFM/K2-Horizon-375B-A23B`.
  A server started without `--api-key` accepts any `IFM_API_KEY` value.
- Only the base URL changes between hosted and self-hosted; everything else in
  client config stays the same.

## 16. Kilo Code implementation map

Kilo (CLI: `packages/opencode/`, a fork of opencode; Vercel AI SDK abstraction;
providers resolved from a bundled map or installed at runtime; models from
models.dev cached locally) already has partial K2 support.

### Already implemented — verify, do not redo

- `packages/opencode/src/kilocode/provider/ifm-k2.ts` — K2 family defaults:
  `REASONING_FIELD = "reasoning_content"`; `EFFORTS = ["low","medium","high"]`
  with `effortVariants()` emitting `{ chat_template_kwargs: { reasoning_effort:
  effort } }` per effort; `isK2(apiID)` regex
  `/(?:^|\/)k2-(?:think|horizon)(?:[.-]|$)/i` (matches `IFM/K2-Horizon-375B-A23B`,
  excludes Moonshot `kimi-k2` and `K2-V2-Instruct`); `applyDefaults(model, cfg)`
  auto-sets `capabilities.reasoning = true` and
  `capabilities.interleaved = { field: "reasoning_content" }` for
  `@ai-sdk/openai-compatible` K2 models when the user has not set them
  explicitly. Wired into config parsing at
  `packages/opencode/src/provider/provider.ts` (config-model parsing loop,
  `IfmK2.applyDefaults(...)`) and into variants at
  `packages/opencode/src/kilocode/provider/provider.ts` (`customProviderVariants`).
  Tests: `packages/opencode/test/kilocode/ifm-k2-provider.test.ts`.
- `interleaved` replay path: `packages/opencode/src/provider/transform.ts`
  `normalizeMessages()` extracts assistant reasoning parts and reattaches them
  as `providerOptions.openaiCompatible[field]` — this is the `reasoning_content`
  verbatim-replay mechanism required by §6. `interleaved` is schema-supported
  as `bool | { field: "reasoning"|"reasoning_content"|string }` in
  `packages/core/src/v1/config/provider.ts` and is only valid inside a model
  entry (provider-level is ignored — matches the IFM docs' OpenCode note).
- Session routing headers: `packages/opencode/src/session/llm/request.ts`
  `prepare()` already injects `X-Session-Id` (and `x-session-affinity`) with
  the session id for every non-kilo provider per request — satisfies §10.
- Streaming: `packages/opencode/src/session/llm/ai-sdk.ts` maps AI SDK
  `reasoning-start/-delta/-end` parts; `packages/opencode/src/session/processor.ts`
  assembles reasoning/text/tool parts from the `LLMEvent` stream; persisted
  reasoning parts are replayed on later turns via
  `packages/opencode/src/session/message-v2.ts`.
- Per-request headers/options: `resolveSDK` in
  `packages/opencode/src/provider/provider.ts` merges model-level `headers` and
  provider `options` (`baseURL`, `apiKey`, `fetch` with timeout/chunk handling)
  into the `@ai-sdk/openai-compatible` factory call. Variant options such as
  `chat_template_kwargs` ride in `providerOptions.openaiCompatible` and the
  OpenAI-compatible SDK forwards unknown body keys.

### Gaps to implement

1. **Tool format params** (`tool_presentation_format: "xml"`,
   `tool_call_format: "xml"`) — not present anywhere in
   `packages/opencode/src`. Implement in
   `packages/opencode/src/provider/transform.ts` `providerOptions()` for K2
   models (`isK2` + `@ai-sdk/openai-compatible`), keeping user-set values
   authoritative, or add them to the K2 effort/base variants in
   `ifm-k2.ts`. Validate against the live hosted endpoint whether they are
   required for hosted traffic (§7).
2. **Sampling defaults for K2 Horizon** — the docs recommend temperature 1.0 /
   top_p 0.95 for K2 Horizon (§4), while the parameter table says use ≤0.3 for
   agentic workloads. Check the per-model-ID heuristics in
   `transform.ts` `temperature()`/`topP()` and decide a K2 default; user-set
   values must always win.
3. **Provider registration** — works config-only today (below). Optionally add
   a built-in `ifm` entry via the overlay in
   `packages/opencode/src/provider/models.ts` (`ModelsDev.Service` overlays
   `kilo` and `apertis` providers) or a custom loader entry in
   `kiloCustomLoaders()` (`packages/opencode/src/kilocode/provider/provider.ts`),
   following the `apertis` / `openrouter` patterns: npm `@ai-sdk/openai-compatible`,
   name `IFM`, env `["IFM_API_KEY"]`, baseURL `https://api.ifm.ai/v1`.
4. **410 `deprecated_model_error` handling** — the error body carries the
   migration-guide URL; ensure error surfacing in the CLI/clients preserves
   and shows it (§3, §12).
5. **Rate-limit headers** — `x-ratelimit-remaining-tokens-daily` etc. are
   informational; optionally surface daily-remaining tokens in status/usage
   displays (§11).
6. **Transcription** — `IFM/Jais-ASR` on `/v1/audio/transcriptions` is
   OpenAI-compatible. Kilo has a Kilo-Gateway transcription proxy pattern
   (`packages/opencode/src/kilocode/server/httpapi/groups/kilo-gateway.ts`),
   not an IFM-specific one; IFM transcription would ride a provider-side
   integration if wanted (§13).

### Config-only provider registration (no code changes)

Place in project `kilo.json` / `~/.config/kilo/kilo.json` (or the equivalent
`opencode.json` — both are discovered):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "ifm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "IFM",
      "env": ["IFM_API_KEY"],
      "options": {
        "baseURL": "https://api.ifm.ai/v1",
        "apiKey": "{env:IFM_API_KEY}"
      },
      "models": {
        "IFM/K2-Horizon-375B-A23B": {
          "name": "K2 Horizon 375B A23B",
          "reasoning": true,
          "tool_call": true,
          "interleaved": "reasoning_content"
        }
      }
    }
  },
  "model": "ifm/IFM/K2-Horizon-375B-A23B"
}
```

- `interleaved` must be inside the model entry (never at provider level —
  ignored there, and conversations break as soon as the model returns an empty
  reasoning trace).
- Because the model id matches `IfmK2.isK2` and npm is
  `@ai-sdk/openai-compatible`, `reasoning`/`interleaved` defaults and the
  `chat_template_kwargs.reasoning_effort` effort variants auto-apply even
  without the explicit fields; explicit user values always win.
- Set `limit.context` (512K → use 524288) and `limit.output` on the model entry
  for accurate context management; `maxOutputTokens` is capped at 32,000 by
  `transform.ts` `OUTPUT_TOKEN_MAX`.
- `X-Session-Id` per-request header is already injected — no action needed.
- Self-hosted: only `baseURL` changes (e.g. `http://<host>:8000/v1`); a local
  server needing no auth can drop `apiKey` entirely. `IFM_MODEL` must match the
  vLLM-served name.

### Verification

- Existing tests: `bun test ./test/kilocode/ifm-k2-provider.test.ts` from
  `packages/opencode/` (covers `isK2`, effort variants, defaults application).
- After changes: `bun run typecheck` and `bun test` from `packages/opencode/`;
  changes to shared upstream files must be isolated behind `kilocode_change`
  markers with logic in `src/kilocode/**` (see the fork isolation rule in
  `packages/opencode/AGENTS.md`).
- Live smoke test: point `IFM_BASE_URL` at `https://api.ifm.ai/v1`, set
  `IFM_API_KEY`, run one chat completion, one tool-call loop, one streamed
  turn, and confirm reasoning replay across turns (§6).
