export const MISTRAL_FIM_URL = "https://api.mistral.ai/v1/fim/completions"
export const CODESTRAL_FIM_URL = "https://codestral.mistral.ai/v1/fim/completions"

let preferred: string | undefined

export function isMistralEndpointMismatch(response: Response) {
  return response.status === 401 || response.status === 403
}

export function clearMistralFimEndpointCache() {
  preferred = undefined
}

export function getCachedMistralFimEndpoint() {
  return preferred
}

export async function requestMistralFim(request: (url: string) => Promise<Response>) {
  const firstUrl = preferred ?? MISTRAL_FIM_URL
  const secondUrl = firstUrl === MISTRAL_FIM_URL ? CODESTRAL_FIM_URL : MISTRAL_FIM_URL
  const first = await request(firstUrl)

  if (first.ok) return first
  if (!isMistralEndpointMismatch(first)) return first

  preferred = undefined
  const second = await request(secondUrl)
  if (second.ok) preferred = secondUrl
  return second
}
