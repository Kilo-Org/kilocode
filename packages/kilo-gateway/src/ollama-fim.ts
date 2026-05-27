const encoder = new TextEncoder()

export const OLLAMA_FIM_URL = "http://localhost:11434/api/generate"
const OLLAMA_FIM_MAX_TOKENS = 16

type OllamaChunk = {
  response?: string
  done?: boolean
  prompt_eval_count?: number
  eval_count?: number
}

type OllamaFimInput = {
  model: string
  prefix: string
  suffix: string
  maxTokens: number
  temperature: number
  signal?: AbortSignal
}

function event(line: string) {
  if (!line.trim()) return
  const chunk = JSON.parse(line) as OllamaChunk
  if (!chunk.response && !chunk.done) return
  return `data: ${JSON.stringify({
    ...(chunk.response ? { choices: [{ delta: { content: chunk.response } }] } : {}),
    ...(chunk.done
      ? {
          usage: {
            prompt_tokens: chunk.prompt_eval_count ?? 0,
            completion_tokens: chunk.eval_count ?? 0,
          },
        }
      : {}),
  })}\n\n`
}

function convert(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  const state = { text: "" }
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        state.text += decoder.decode(chunk, { stream: true })
        const lines = state.text.split("\n")
        state.text = lines.pop() ?? ""
        for (const line of lines) {
          const data = event(line)
          if (data) ctl.enqueue(encoder.encode(data))
        }
      },
      flush(ctl) {
        const data = event(state.text + decoder.decode())
        if (data) ctl.enqueue(encoder.encode(data))
      },
    }),
  )
}

export async function requestOllamaFim(url: string, input: OllamaFimInput) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: input.signal,
    body: JSON.stringify({
      model: input.model,
      prompt: input.prefix,
      suffix: input.suffix,
      options: {
        num_predict: Math.min(input.maxTokens, OLLAMA_FIM_MAX_TOKENS),
        temperature: input.temperature,
      },
      stream: true,
    }),
  })
  if (!response.ok || !response.body) return response
  return new Response(convert(response.body), { status: response.status, headers: response.headers })
}
