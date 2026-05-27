import { describe, expect, test } from "bun:test"
import {
  CODESTRAL_FIM_URL,
  MISTRAL_FIM_URL,
  clearMistralFimEndpointCache,
  getCachedMistralFimEndpoint,
  requestMistralFim,
} from "../src/mistral-fim-endpoint"

function response(status: number) {
  return new Response(null, { status })
}

describe("Mistral FIM endpoint cache", () => {
  test("remembers Codestral endpoint after successful fallback", async () => {
    clearMistralFimEndpointCache()
    const urls: string[] = []
    const first = await requestMistralFim(async (url) => {
      urls.push(url)
      return response(url === MISTRAL_FIM_URL ? 401 : 200)
    })
    const second = await requestMistralFim(async (url) => {
      urls.push(url)
      return response(200)
    })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(urls).toEqual([MISTRAL_FIM_URL, CODESTRAL_FIM_URL, CODESTRAL_FIM_URL])
    expect(getCachedMistralFimEndpoint()).toBe(CODESTRAL_FIM_URL)
  })

  test("does not remember fallback for invalid credentials", async () => {
    clearMistralFimEndpointCache()
    const urls: string[] = []
    const res = await requestMistralFim(async (url) => {
      urls.push(url)
      return response(401)
    })

    expect(res.status).toBe(401)
    expect(urls).toEqual([MISTRAL_FIM_URL, CODESTRAL_FIM_URL])
    expect(getCachedMistralFimEndpoint()).toBeUndefined()
  })

  test("uses one process-local endpoint preference", async () => {
    clearMistralFimEndpointCache()
    const urls: string[] = []
    await requestMistralFim(async (url) => {
      urls.push(url)
      return response(url === MISTRAL_FIM_URL ? 403 : 200)
    })
    await requestMistralFim(async (url) => {
      urls.push(url)
      return response(200)
    })

    expect(urls).toEqual([MISTRAL_FIM_URL, CODESTRAL_FIM_URL, CODESTRAL_FIM_URL])
    expect(getCachedMistralFimEndpoint()).toBe(CODESTRAL_FIM_URL)
  })

  test("clears stale preference and probes alternate endpoint", async () => {
    clearMistralFimEndpointCache()
    const urls: string[] = []
    await requestMistralFim(async (url) => response(url === MISTRAL_FIM_URL ? 401 : 200))
    const res = await requestMistralFim(async (url) => {
      urls.push(url)
      return response(url === CODESTRAL_FIM_URL ? 401 : 200)
    })

    expect(res.ok).toBe(true)
    expect(urls).toEqual([CODESTRAL_FIM_URL, MISTRAL_FIM_URL])
    expect(getCachedMistralFimEndpoint()).toBe(MISTRAL_FIM_URL)
  })
})
