// Shared request rules of the direct usage sources, as in v1: a 5 second timeout, no redirects, and at most 64 KiB of
// response body.
const limit = 64 * 1024
const timeout = 5_000

export class TooLarge extends Error {}

export function get(url: string, headers: Record<string, string>, fetcher: typeof fetch) {
  return fetcher(url, {
    method: "GET",
    headers: { Accept: "application/json", ...headers },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  })
}

export async function text(response: Response) {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > limit) {
    response.body?.cancel().catch(() => undefined)
    throw new TooLarge()
  }
  if (!response.body) {
    const value = await response.arrayBuffer()
    if (value.byteLength > limit) throw new TooLarge()
    return new TextDecoder().decode(value)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => undefined)
      throw new TooLarge()
    }
    chunks.push(chunk.value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}
