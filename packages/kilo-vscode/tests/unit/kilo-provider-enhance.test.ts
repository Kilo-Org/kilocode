import { describe, expect, it } from "bun:test"
import { EnhanceRequests } from "../../src/kilo-provider/enhance-prompt"

type Reply = (signal: AbortSignal) => Promise<{ data: { text: string } }>

// Waits forever, like a request on a dropped network, and rejects only when aborted.
const hang: Reply = (signal) =>
  new Promise((_, reject) =>
    signal.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError"))),
  )

function client(reply: Reply) {
  const signals: AbortSignal[] = []
  return {
    signals,
    value: {
      enhancePrompt: {
        enhance: (_body: { text: string }, opts: { signal: AbortSignal }) => {
          signals.push(opts.signal)
          return reply(opts.signal)
        },
      },
    } as never,
  }
}

function setup(timeout?: number) {
  const posted: unknown[] = []
  const requests = new EnhanceRequests((reply) => posted.push(reply), timeout)
  return { posted, requests }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("EnhanceRequests", () => {
  it("posts the enhanced text when the request finishes", async () => {
    const state = setup()
    state.requests.start(client(async () => ({ data: { text: "Enhanced" } })).value, "Draft", "enhance-1")
    await flush()

    expect(state.posted).toEqual([{ type: "enhancePromptResult", text: "Enhanced", requestId: "enhance-1" }])
  })

  it("aborts a cancelled request and reports nothing", async () => {
    const state = setup()
    const api = client(hang)
    state.requests.start(api.value, "Draft", "enhance-1")
    state.requests.cancel("enhance-1")
    await flush()

    expect(api.signals.map((signal) => signal.aborted)).toEqual([true])
    expect(state.posted).toEqual([])
  })

  it("cancels only the request with the given id", async () => {
    const state = setup()
    const api = client(hang)
    state.requests.start(api.value, "Draft", "enhance-1")
    state.requests.start(api.value, "Draft", "enhance-2")
    state.requests.cancel("enhance-1")
    await flush()

    expect(api.signals.map((signal) => signal.aborted)).toEqual([true, false])
    state.requests.dispose()
    expect(api.signals.map((signal) => signal.aborted)).toEqual([true, true])
  })

  it("reports a failed request to the webview", async () => {
    const state = setup()
    const api = client(async () => {
      throw new Error("Incorrect API key provided")
    })
    state.requests.start(api.value, "Draft", "enhance-1")
    await flush()

    expect(state.posted).toEqual([
      { type: "enhancePromptError", error: "Incorrect API key provided", reason: "failed", requestId: "enhance-1" },
    ])
  })

  it("stops a request that runs past the timeout and reports it", async () => {
    const state = setup(20)
    const api = client(hang)
    state.requests.start(api.value, "Draft", "enhance-1")
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(api.signals.map((signal) => signal.aborted)).toEqual([true])
    expect(state.posted).toEqual([
      { type: "enhancePromptError", error: "No reply after 0.02 s", reason: "timeout", requestId: "enhance-1" },
    ])
  })

  it("answers right away when the backend is not connected", () => {
    const state = setup()
    state.requests.start(null, "Draft", "enhance-1")

    expect(state.posted).toEqual([
      { type: "enhancePromptError", error: "Not connected to CLI backend", reason: "failed", requestId: "enhance-1" },
    ])
  })
})
