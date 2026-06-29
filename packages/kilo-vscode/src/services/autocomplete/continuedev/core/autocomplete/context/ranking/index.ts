const rx = /[\s.,/#!$%^&*;:{}=\-_`~()[\]]/g

export function getSymbolsForSnippet(snippet: string): Set<string> {
  const symbols = snippet
    .split(rx)
    .map((symbol) => symbol.trim())
    .filter((symbol) => symbol !== "")
  return new Set(symbols)
}
