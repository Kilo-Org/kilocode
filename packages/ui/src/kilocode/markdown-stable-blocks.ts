import type { Block } from "../components/markdown-stream"

type Token = {
  type: string
  raw: string
}

export function stableBlocks(tokens: Token[], live: (raw: string) => string): Block[] | undefined {
  const indexes = tokens.flatMap((token, index) => (token.type === "space" ? [] : [index]))
  if (indexes.length < 2) return

  const raw = (start: number, end = tokens.length) =>
    tokens
      .slice(start, end)
      .map((token) => token.raw)
      .join("")
  // Completed top-level tokens keep stable hashes across stream updates. The
  // existing parse and sanitize cache can then reuse them while only the tail changes.
  const stable = indexes.slice(0, -1).map((start, index) => {
    const value = raw(start, indexes[index + 1])
    return { raw: value, src: value, mode: "full" as const }
  })
  const tail = raw(indexes.at(-1)!)
  return [...stable, { raw: tail, src: live(tail), mode: "live" }]
}
