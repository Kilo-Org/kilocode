export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
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
    const result = await embed(batch)
    embeddings.push(...result.embeddings)
    usage.promptTokens += result.usage.promptTokens
    usage.totalTokens += result.usage.totalTokens
  }

  return { embeddings, usage }
}
