import { beforeEach, describe, expect, it } from "bun:test"
import { createSpeechToTextHost } from "../src/speech-to-text/host"

type Posted = Record<string, unknown> & { type: string }
type Capture = {
  start: (input: { requestId: string; model: string; language?: string }) => Promise<boolean>
  stop: (requestId: string) => Promise<{ data: string; format: "m4a"; model: string; language?: string }>
  cancel: (requestId: string) => Promise<void>
}
type Transcribe = (input: {
  signal?: AbortSignal
}) => Promise<{ ok: true; text: string } | { ok: false; error: string; code?: string }>

const state = {
  settings: {} as { baseUrl?: string; apiKey?: string; model?: string },
  signedIn: true,
  capture: undefined as Capture | undefined,
  transcribe: undefined as Transcribe | undefined,
}

const deps = {
  start: (input: { requestId: string; model: string; language?: string }) =>
    state.capture?.start(input) ?? Promise.resolve(true),
  stop: (requestId: string) => state.capture?.stop(requestId) ?? Promise.reject(new Error("no recording")),
  cancel: (requestId: string) => state.capture?.cancel(requestId) ?? Promise.resolve(),
  prewarm: () => Promise.resolve(),
  readSettings: async () => state.settings,
  writeTarget: () => "/tmp/kilo-speech-test.json",
  fetchModels: async () => ({
    ok: true as const,
    models: [{ id: "gw/model", label: "Gateway Model", provider: "Kilo" }],
  }),
  signedIn: async () => state.signedIn,
  staticModels: () => [{ id: "static/model", label: "Static Model", provider: "Kilo" }],
  transcribe: (input: { signal?: AbortSignal }) =>
    state.transcribe?.(input) ?? Promise.resolve({ ok: true as const, text: "default" }),
}

async function waitFor(check: () => boolean, label: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${label}`)
}

function setup() {
  const posted: Posted[] = []
  const host = createSpeechToTextHost({
    server: { get: async () => ({ url: "http://127.0.0.1:1", authorization: "Basic test" }) } as never,
    directory: "/repo",
    remote: false,
    profile: "/profile",
    deps,
    post: (message) => posted.push(message as Posted),
  })
  const find = (type: string) => posted.filter((item) => item.type === type)
  return { host, posted, find }
}

beforeEach(() => {
  state.settings = {}
  state.signedIn = true
  state.capture = undefined
  state.transcribe = undefined
})

describe("speech host status", () => {
  it("reports a custom source from the machine-wide settings", async () => {
    state.settings = { baseUrl: "http://speech.test/v1", model: "custom-model" }
    const { host, find } = setup()
    host.handle({ type: "speechToTextConfig" })
    await waitFor(() => find("speechToTextConfigLoaded").length === 1, "status")
    expect(find("speechToTextConfigLoaded")[0]?.status).toMatchObject({
      enabled: true,
      source: "custom",
      signedIn: false,
      model: "custom-model",
    })
    host.dispose()
  })

  it("reports the Gateway catalog when signed in", async () => {
    const { host, find } = setup()
    host.handle({ type: "speechToTextConfig" })
    await waitFor(() => find("speechToTextConfigLoaded").length === 1, "status")
    expect(find("speechToTextConfigLoaded")[0]?.status).toMatchObject({
      enabled: true,
      source: "gateway",
      signedIn: true,
      model: "gw/model",
    })
    host.dispose()
  })
})

describe("speech host recording", () => {
  it("acknowledges start and posts the transcript after stop", async () => {
    state.capture = {
      start: async () => true,
      stop: async (id) => ({ data: "AAAA", format: "m4a", model: id }),
      cancel: async () => {},
    }
    state.transcribe = async () => ({ ok: true, text: "hello there" })
    const { host, find } = setup()

    host.handle({ type: "speechToTextStart", requestId: "1", model: "custom" })
    await waitFor(() => find("speechToTextStarted").length === 1, "started")
    host.handle({ type: "speechToTextStop", requestId: "1" })
    await waitFor(() => find("speechToTextResult").length === 1, "result")

    expect(find("speechToTextResult")[0]).toMatchObject({ requestId: "1", text: "hello there" })
    host.dispose()
  })

  it("stops a recording that was still starting", async () => {
    let started: (value: boolean) => void = () => {}
    let stops = 0
    state.capture = {
      start: () => new Promise((resolve) => (started = resolve)),
      stop: async (id) => {
        stops++
        return { data: "AAAA", format: "m4a", model: id }
      },
      cancel: async () => {},
    }
    state.transcribe = async () => ({ ok: true, text: "queued" })
    const { host, find } = setup()

    host.handle({ type: "speechToTextStart", requestId: "1", model: "custom" })
    host.handle({ type: "speechToTextStop", requestId: "1" })
    expect(stops).toBe(0)
    started(true)
    await waitFor(() => find("speechToTextResult").length === 1, "result")

    expect(stops).toBe(1)
    expect(find("speechToTextResult")[0]).toMatchObject({ text: "queued" })
    host.dispose()
  })

  it("ignores a duplicate stop for the same request", async () => {
    let resolveTranscribe: (value: { ok: true; text: string }) => void = () => {}
    let transcribing = false
    state.capture = {
      start: async () => true,
      stop: async (id) => ({ data: "AAAA", format: "m4a", model: id }),
      cancel: async () => {},
    }
    state.transcribe = () => {
      transcribing = true
      return new Promise((resolve) => (resolveTranscribe = resolve))
    }
    const { host, find } = setup()

    host.handle({ type: "speechToTextStart", requestId: "1", model: "custom" })
    await waitFor(() => find("speechToTextStarted").length === 1, "started")
    host.handle({ type: "speechToTextStop", requestId: "1" })
    host.handle({ type: "speechToTextStop", requestId: "1" })
    await waitFor(() => transcribing, "transcribing")
    resolveTranscribe({ ok: true, text: "once" })
    await waitFor(() => find("speechToTextResult").length === 1, "result")
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(find("speechToTextResult")).toHaveLength(1)
    expect(find("speechToTextError")).toHaveLength(0)
    host.dispose()
  })

  it("cancels an in-flight transcription without posting a result", async () => {
    state.capture = {
      start: async () => true,
      stop: async (id) => ({ data: "AAAA", format: "m4a", model: id }),
      cancel: async () => {},
    }
    state.transcribe = (input) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: true, text: "late" }), 20)
        input.signal?.addEventListener("abort", () => {
          clearTimeout(timer)
          resolve({ ok: false, error: "cancelled", code: "cancelled" })
        })
      })
    const { host, find } = setup()

    host.handle({ type: "speechToTextStart", requestId: "1", model: "custom" })
    await waitFor(() => find("speechToTextStarted").length === 1, "started")
    host.handle({ type: "speechToTextStop", requestId: "1" })
    host.handle({ type: "speechToTextCancel", requestId: "1" })
    await waitFor(() => find("speechToTextCancelled").length === 1, "cancelled")
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(find("speechToTextResult")).toHaveLength(0)
    host.dispose()
  })

  it("cancels capture that is still starting and ignores its acknowledgement", async () => {
    let cancelled = 0
    let resolveStart: (value: boolean) => void = () => {}
    state.capture = {
      start: () => new Promise((resolve) => (resolveStart = resolve)),
      stop: async (id) => ({ data: "AAAA", format: "m4a", model: id }),
      cancel: async () => {
        cancelled++
      },
    }
    const { host, find } = setup()

    host.handle({ type: "speechToTextStart", requestId: "1", model: "custom" })
    host.handle({ type: "speechToTextCancel", requestId: "1" })
    resolveStart(true)
    await waitFor(() => find("speechToTextCancelled").length === 1, "cancelled")
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(cancelled).toBe(1)
    expect(find("speechToTextStarted")).toHaveLength(0)
    host.dispose()
  })

  it("cancels a pending start exactly once on dispose", async () => {
    let cancelled = 0
    let resolveStart: (value: boolean) => void = () => {}
    state.capture = {
      start: () => new Promise((resolve) => (resolveStart = resolve)),
      stop: async (id) => ({ data: "AAAA", format: "m4a", model: id }),
      cancel: async () => {
        cancelled++
      },
    }
    const { host, find } = setup()

    host.handle({ type: "speechToTextStart", requestId: "1", model: "custom" })
    host.dispose()
    resolveStart(true)
    await waitFor(() => cancelled === 1, "capture cancel")
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(cancelled).toBe(1)
    expect(find("speechToTextCancelled")).toHaveLength(1)
    expect(find("speechToTextStarted")).toHaveLength(0)
  })

  it("cancels an active recording on dispose", async () => {
    let cancelled = 0
    state.capture = {
      start: async () => true,
      stop: async (id) => ({ data: "AAAA", format: "m4a", model: id }),
      cancel: async () => {
        cancelled++
      },
    }
    const { host, find } = setup()

    host.handle({ type: "speechToTextStart", requestId: "1", model: "custom" })
    await waitFor(() => find("speechToTextStarted").length === 1, "started")
    host.dispose()
    await waitFor(() => cancelled === 1, "capture cancel")
  })
})
