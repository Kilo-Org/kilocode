// Simulated provider socket for the issue #6905 reproduction.
//
// Script per session turn:
//   1. title request -> short text answer
//   2. first agent request -> SSE tool call named "Write" (wrong case; the
//      registered tool is "write"), exercising Kilo's lowercase repair path
//   3. second agent request -> SSE tool call with an entirely unknown name,
//      exercising the repairToolCall fallback that rewrites to "invalid"
//   4. later requests -> final text answer

const HEAD = { id: "chatcmpl-badtool", object: "chat.completion.chunk", created: 0, model: "mock-model" }

type State = { calls: number }

const chunk = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`

function sse(body: string) {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })
}

function usage() {
  return chunk({ ...HEAD, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
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

function toolCall(name: string, args: Record<string, unknown>) {
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
                { index: 0, id: `call_${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } },
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

export function createBadToolCallTransport(input: { state: string }) {
  const save = (state: State) => Bun.write(input.state, JSON.stringify(state))

  return async (_input: unknown, init?: { body?: unknown }) => {
    const body = typeof init?.body === "string" ? init.body : ""
    const current = JSON.parse(await Bun.file(input.state).exists() ? await Bun.file(input.state).text() : '{"calls":0}') as State
    if (body.includes("Generate a title")) return answer("Bad tool call repro")

    current.calls++
    await save(current)

    if (current.calls === 1) return toolCall("Write", { filePath: "test.txt", content: "hello" })
    if (current.calls === 2) return toolCall("WriteFileToDisk", { filePath: "test.txt", content: "hello again" })
    return answer("done")
  }
}
