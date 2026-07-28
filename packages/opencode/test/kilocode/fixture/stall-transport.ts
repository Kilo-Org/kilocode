// Simulated provider socket for the issue #8656 regression tests.
//
// Only the socket is simulated. The transport is injected as the provider's
// `fetch` option, so Kilo's own fetch wrapper (connection timeout, first-byte
// guard, SSE chunk watchdog), the openai-compatible SDK, SSE parsing, the
// session processor and the agent loop are all the production ones.
//
// Request script:
//   1. title request                  -> short text answer
//   2. no tool result in the messages -> a bash tool call
//   3. first request carrying a tool result -> SSE headers, body never sends a
//      byte (the stall reported in #8656)
//   4. later requests carrying a tool result -> final text answer, so a bounded
//      stall can recover through the normal retry path
//
// Progress is mirrored to a JSON file so tests can assert what the provider saw
// without sharing module state with the plugin that loads this file.

export type StallState = { calls: number; stalls: number; recovered: number }

const HEAD = { id: "chatcmpl-stall", object: "chat.completion.chunk", created: 0, model: "mock-model" }

const chunk = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`

const usage = () =>
  chunk({ ...HEAD, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })

function sse(body: BodyInit | null) {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })
}

function answer(value: string) {
  return sse(
    [
      chunk({ ...HEAD, choices: [{ index: 0, delta: { role: "assistant", content: value }, finish_reason: null }] }),
      chunk({ ...HEAD, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
      usage(),
      "data: [DONE]\n\n",
    ].join(""),
  )
}

function toolCall(command: string) {
  return sse(
    [
      chunk({
        ...HEAD,
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "bash", arguments: JSON.stringify({ command }) },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      chunk({ ...HEAD, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
      usage(),
      "data: [DONE]\n\n",
    ].join(""),
  )
}

/** Response headers arrive, then the body never produces a byte. */
function stalling() {
  return sse(
    new ReadableStream<Uint8Array>({
      start() {},
      cancel() {
        // the first-byte guard cancels this reader when it gives up
      },
    }),
  )
}

export function createStallTransport(input: { state: string; answer?: string; command?: string }) {
  const state: StallState = { calls: 0, stalls: 0, recovered: 0 }
  const save = () => Bun.write(input.state, JSON.stringify(state))

  return async (_input: unknown, init?: { body?: unknown }) => {
    const body = typeof init?.body === "string" ? init.body : ""
    state.calls++

    if (body.includes("Generate a title")) {
      await save()
      return answer("Stall repro")
    }

    if (!body.includes('"role":"tool"')) {
      await save()
      return toolCall(input.command ?? "echo repro-8656")
    }

    if (state.stalls === 0) {
      state.stalls++
      await save()
      return stalling()
    }

    state.recovered++
    await save()
    return answer(input.answer ?? "recovered after the stall")
  }
}

export async function readStallState(file: string): Promise<StallState> {
  const handle = Bun.file(file)
  if (!(await handle.exists())) return { calls: 0, stalls: 0, recovered: 0 }
  return JSON.parse(await handle.text()) as StallState
}
