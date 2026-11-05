/** Split paths into request-sized batches, preserving order, so every path is validated. */
export function chunkPaths(paths: string[], size: number): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < paths.length; index += size) chunks.push(paths.slice(index, index + size))
  return chunks
}
