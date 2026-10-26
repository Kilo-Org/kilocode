import { isContextOverflowError } from "./validation-helpers"

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

type EmbedBatchResult = { embeddings: number[][]; usage: { promptTokens: number; totalTokens: number } }

/**
 * Embeds a single batch, splitting it in half and retrying each half when the
 * endpoint rejects the request because the payload exceeded the model's maximum
 * input/context size.
 *
 * The model's context limit is not known up front (see the model registry, which
 * only records embedding dimensions), so the split is driven reactively by the
 * endpoint's own "input too large" 400. Splitting halves the batch until each
 * request fits, which makes small-context embedding models usable without
 * re-sending a payload that is guaranteed to fail. A single-item batch cannot be
 * split further, so it rethrows and the caller reports the failure.
 *
 * The returned embeddings preserve the original item order across the split.
 */
async function embedWithContextSplit(
  batch: string[],
  embed: (texts: string[]) => Promise<EmbedBatchResult>,
): Promise<EmbedBatchResult> {
  try {
    return await embed(batch)
  } catch (error) {
    if (isContextOverflowError(error) && batch.length > 1) {
      const mid = Math.floor(batch.length / 2)
      const left = await embedWithContextSplit(batch.slice(0, mid), embed)
      const right = await embedWithContextSplit(batch.slice(mid), embed)
      return {
        embeddings: [...left.embeddings, ...right.embeddings],
        usage: {
          promptTokens: left.usage.promptTokens + right.usage.promptTokens,
          totalTokens: left.usage.totalTokens + right.usage.totalTokens,
        },
      }
    }
    throw error
  }
}

export function applyQueryPrefix(
  texts: string[],
  prefix: string | undefined,
  maxTokens: number,
  onOverflow?: (index: number, tokens: number) => void,
): string[] {
  if (!prefix) return texts

  return texts.map((text, index) => {
    if (text.startsWith(prefix)) return text

    const prefixed = `${prefix}${text}`
    const tokens = estimateTokenCount(prefixed)
    if (tokens > maxTokens) {
      onOverflow?.(index, tokens)
      return text
    }

    return prefixed
  })
}

export function* batchTextsByTokenBudget(
  texts: string[],
  maxItemTokens: number,
  maxBatchTokens: number,
  onOversized?: (index: number, tokens: number) => void,
): Generator<string[]> {
  const remaining = [...texts]

  while (remaining.length > 0) {
    const batch: string[] = []
    let batchTokens = 0
    const processed: number[] = []

    for (let i = 0; i < remaining.length; i++) {
      const text = remaining[i]
      const tokens = estimateTokenCount(text)

      if (tokens > maxItemTokens) {
        onOversized?.(i, tokens)
        processed.push(i)
        continue
      }

      if (batchTokens + tokens <= maxBatchTokens) {
        batch.push(text)
        batchTokens += tokens
        processed.push(i)
        continue
      }

      break
    }

    for (let i = processed.length - 1; i >= 0; i--) {
      remaining.splice(processed[i], 1)
    }

    if (batch.length > 0) yield batch
  }
}

export async function embedBatches(
  texts: string[],
  maxItemTokens: number,
  maxBatchTokens: number,
  embed: (texts: string[]) => Promise<{ embeddings: number[][]; usage: { promptTokens: number; totalTokens: number } }>,
  onOversized?: (index: number, tokens: number) => void,
  prefix?: string,
  onPrefixOverflow?: (index: number, tokens: number) => void,
): Promise<{ embeddings: number[][]; usage: { promptTokens: number; totalTokens: number } }> {
  const embeddings: number[][] = []
  const usage = { promptTokens: 0, totalTokens: 0 }
  const processed = applyQueryPrefix(texts, prefix, maxItemTokens, onPrefixOverflow)

  for (const batch of batchTextsByTokenBudget(processed, maxItemTokens, maxBatchTokens, onOversized)) {
    const result = await embedWithContextSplit(batch, embed)
    embeddings.push(...result.embeddings)
    usage.promptTokens += result.usage.promptTokens
    usage.totalTokens += result.usage.totalTokens
  }

  return { embeddings, usage }
}
