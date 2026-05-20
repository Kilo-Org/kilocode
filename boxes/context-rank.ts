/**
 * context-rank.ts — TF-IDF cosine similarity snippet ranking
 * Inspired by Continue.dev context ranking (Apache-2.0)
 * Deps: none
 */

export interface Snippet { id: string; text: string }

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(Boolean)
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  return tf
}

function buildIdf(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>()
  for (const doc of docs) {
    for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1)
  }
  const n = docs.length
  const idf = new Map<string, number>()
  for (const [t, f] of df) idf.set(t, Math.log((n + 1) / (f + 1)) + 1)
  return idf
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, na = 0, nb = 0
  for (const [k, v] of a) {
    na += v * v
    const bv = b.get(k) ?? 0
    dot += v * bv
  }
  for (const v of b.values()) nb += v * v
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

export function rankContext(
  query: string,
  snippets: Snippet[],
  topK = 10,
): Snippet[] {
  const qTokens = tokenize(query)
  const allTokens = [qTokens, ...snippets.map(s => tokenize(s.text))]
  const idf = buildIdf(allTokens)

  const tfidf = (tokens: string[]): Map<string, number> => {
    const tf = termFreq(tokens)
    const vec = new Map<string, number>()
    for (const [t, f] of tf) vec.set(t, f * (idf.get(t) ?? 0))
    return vec
  }

  const qVec = tfidf(qTokens)
  return snippets
    .map(s => ({ s, score: cosine(qVec, tfidf(tokenize(s.text))) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(x => x.s)
}
