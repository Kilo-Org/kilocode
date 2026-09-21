import { Mutex } from "async-mutex"

type EmbeddingItem = { embedding: string | number[] }

type EmbeddingUsage = {
  prompt_tokens?: number
  total_tokens?: number
}

export type RateLimitState = {
  isRateLimited: boolean
  rateLimitResetTime: number
  consecutiveRateLimitErrors: number
  lastRateLimitError: number
  mutex: Mutex
}

export function createRateLimitState(): RateLimitState {
  return {
    isRateLimited: false,
    rateLimitResetTime: 0,
    consecutiveRateLimitErrors: 0,
    lastRateLimitError: 0,
    mutex: new Mutex(),
  }
}

export function projectEmbeddingResponse(response: { data: EmbeddingItem[]; usage?: EmbeddingUsage }): {
  embeddings: number[][]
  usage: { promptTokens: number; totalTokens: number }
} {
  return {
    embeddings: response.data.map((item) => {
      if (typeof item.embedding !== "string") return item.embedding
      const buffer = Buffer.from(item.embedding, "base64")
      return Array.from(new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4))
    }),
    usage: {
      promptTokens: response.usage?.prompt_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
    },
  }
}

export async function waitForRateLimit(state: RateLimitState): Promise<void> {
  const release = await state.mutex.acquire()

  if (state.isRateLimited && state.rateLimitResetTime > Date.now()) {
    const wait = state.rateLimitResetTime - Date.now()
    release()
    await new Promise((resolve) => setTimeout(resolve, wait))
    return
  }

  if (state.isRateLimited) {
    state.isRateLimited = false
    state.consecutiveRateLimitErrors = 0
  }

  release()
}

export async function updateRateLimitState(state: RateLimitState): Promise<void> {
  const release = await state.mutex.acquire()
  const now = Date.now()

  state.consecutiveRateLimitErrors = now - state.lastRateLimitError < 60000 ? state.consecutiveRateLimitErrors + 1 : 1
  state.lastRateLimitError = now
  state.isRateLimited = true
  state.rateLimitResetTime = now + Math.min(5000 * Math.pow(2, state.consecutiveRateLimitErrors - 1), 300000)

  release()
}

export async function getRateLimitDelay(state: RateLimitState): Promise<number> {
  const release = await state.mutex.acquire()
  const delay = state.isRateLimited && state.rateLimitResetTime > Date.now() ? state.rateLimitResetTime - Date.now() : 0
  release()
  return delay
}
