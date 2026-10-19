import { beforeEach, describe, expect, test } from "bun:test"
import { KiloAutocomplete } from "../src/index.js"

const MISTRAL = KiloAutocomplete.MISTRAL_FIM_URL
const CODESTRAL = KiloAutocomplete.CODESTRAL_FIM_URL

// Sends one request through `requestMistralFim` and records the endpoints it tries in order.
async function send(status: (url: string) => number) {
  const urls: string[] = []
  const response = await KiloAutocomplete.requestMistralFim(async (url) => {
    urls.push(url)
    return new Response(null, { status: status(url) })
  })
  return { status: response.status, urls }
}

describe("Mistral FIM endpoint preference", () => {
  beforeEach(() => KiloAutocomplete.clearMistralFimEndpointCache())

  test("remembers the Codestral endpoint after a successful fallback from 401 or 403", async () => {
    expect(await send((url) => (url === MISTRAL ? 401 : 200))).toEqual({ status: 200, urls: [MISTRAL, CODESTRAL] })
    expect(await send(() => 200)).toEqual({ status: 200, urls: [CODESTRAL] })

    KiloAutocomplete.clearMistralFimEndpointCache()
    expect(await send((url) => (url === MISTRAL ? 403 : 200))).toEqual({ status: 200, urls: [MISTRAL, CODESTRAL] })
    expect(await send(() => 200)).toEqual({ status: 200, urls: [CODESTRAL] })
  })

  test("does not remember a fallback when both endpoints reject the key", async () => {
    expect(await send(() => 401)).toEqual({ status: 401, urls: [MISTRAL, CODESTRAL] })
    expect((await send(() => 200)).urls).toEqual([MISTRAL])
  })

  test("returns other errors without a fallback", async () => {
    expect(await send(() => 500)).toEqual({ status: 500, urls: [MISTRAL] })
  })

  test("clears a stale preference and probes the other endpoint", async () => {
    await send((url) => (url === MISTRAL ? 401 : 200))
    expect(await send((url) => (url === CODESTRAL ? 401 : 200))).toEqual({ status: 200, urls: [CODESTRAL, MISTRAL] })
    expect((await send(() => 200)).urls).toEqual([MISTRAL])
  })
})
