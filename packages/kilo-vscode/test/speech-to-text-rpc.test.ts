import { afterAll, describe, expect, it } from "bun:test"
import { callSpeechRpc } from "../src/speech-to-text/rpc"

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.endsWith("/slow")) await new Promise((resolve) => setTimeout(resolve, 200))
    return Response.json({ output: { ok: true } })
  },
})

afterAll(() => server.stop(true))

const target = { url: `http://localhost:${server.port}`, authorization: "Basic test" }

describe("callSpeechRpc", () => {
  it("uses the short default timeout for catalog and account calls", async () => {
    expect(await callSpeechRpc({ server: target, directory: "/repo", method: "fast", body: {} })).toEqual({ ok: true })
  })

  it("lets a slow transcription override the default timeout", async () => {
    await expect(
      callSpeechRpc({ server: target, directory: "/repo", method: "slow", body: {}, timeoutMs: 20 }),
    ).rejects.toThrow()
  })
})
