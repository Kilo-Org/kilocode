import { beforeEach, describe, expect, it } from "bun:test"
import { createSpeechAuthWatcher, createSpeechToTextHost } from "../src/speech-to-text/host"
import type { SpeechCatalogResult } from "../src/speech-to-text/catalog"

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
  fetchModels: undefined as (() => Promise<SpeechCatalogResult>) | undefined,
}

const deps = {
  start: (input: { requestId: string; model: string; language?: string }) =>
    state.capture?.start(input) ?? Promise.resolve(true),
  stop: (requestId: string) => state.capture?.stop(requestId) ?? Promise.reject(new Error("no recording")),
  cancel: (requestId: string) => state.capture?.cancel(requestId) ?? Promise.resolve(),
  prewarm: () => Promise.resolve(),
  readSettings: async () => state.settings,
  writeTarget: () => "/tmp/kilo-speech-test.json",
  fetchModels: async () =>
    state.fetchModels?.() ?? {
      ok: true as const,
      models: [{ id: "gw/model", label: "Gateway Model", provider: "Kilo" }],
    },
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

function setup(opts?: { onAuthChange?: (listener: () => void) => () => void; directory?: string }) {
  const posted: Posted[] = []
  const host = createSpeechToTextHost({
    server: { get: async () => ({ url: "http://127.0.0.1:1", authorization: "Basic test" }) } as never,
    directory: opts?.directory ?? "/repo",
    remote: false,
    profile: "/profile",
    onAuthChange: opts?.onAuthChange,
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
  state.fetchModels = undefined
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

describe("speech host auth and 401 invalidation", () => {
  it("reuses the cached Gateway catalog within TTL while auth is unchanged", async () => {
    let fetches = 0
    state.fetchModels = async () => {
      fetches++
      return { ok: true, models: [{ id: `gw/model-${fetches}`, label: "Model", provider: "Kilo" }] }
    }
    const { host, find } = setup()

    host.handle({ type: "speechToTextConfig" })
    await waitFor(() => find("speechToTextConfigLoaded").length === 1, "first status")
    host.handle({ type: "speechToTextConfig" })
    await waitFor(() => find("speechToTextConfigLoaded").length === 2, "second status")

    expect(fetches).toBe(1)
    expect(find("speechToTextConfigLoaded")[1]?.status).toMatchObject({ model: "gw/model-1" })
    host.dispose()
  })

  it("invalidates the cached catalog and refreshes status on a 401 transcription error", async () => {
    let fetches = 0
    state.fetchModels = async () => {
      fetches++
      return { ok: true, models: [{ id: `gw/model-${fetches}`, label: `Model ${fetches}`, provider: "Kilo" }] }
    }
    state.capture = {
      start: async () => true,
      stop: async (id) => ({ data: "AAAA", format: "m4a", model: id }),
      cancel: async () => {},
    }
    state.transcribe = async () => {
      state.signedIn = false
      return { ok: false, error: "Sign in to Kilo to use speech input.", code: "not_authenticated" }
    }

    const { host, find } = setup()
    host.handle({ type: "speechToTextConfig" })
    await waitFor(() => find("speechToTextConfigLoaded").length === 1, "initial status")
    expect(fetches).toBe(1)
    expect(find("speechToTextConfigLoaded")[0]?.status).toMatchObject({ enabled: true, signedIn: true, model: "gw/model-1" })

    host.handle({ type: "speechToTextStart", requestId: "1", model: "gw/model-1" })
    await waitFor(() => find("speechToTextStarted").length === 1, "started")
    host.handle({ type: "speechToTextStop", requestId: "1" })

    await waitFor(() => find("speechToTextError").length === 1, "401 error")
    await waitFor(() => find("speechToTextConfigLoaded").length === 2, "refreshed status after 401")

    expect(find("speechToTextError")[0]).toMatchObject({ requestId: "1", code: "not_authenticated" })
    expect(fetches).toBe(2)
    expect(find("speechToTextConfigLoaded")[1]?.status).toMatchObject({
      enabled: false,
      signedIn: false,
      model: "gw/model-2",
    })
    host.dispose()
  })

  it("invalidates catalog and pushes updated status when onAuthChange fires, without stale in-flight poisoning", async () => {
    const authListeners = new Set<() => void>()
    const triggerAuth = () => authListeners.forEach((fn) => fn())
    let fetches = 0
    let resolveStale: ((value: SpeechCatalogResult) => void) | undefined
    state.fetchModels = () => {
      fetches++
      if (fetches === 1) return new Promise((resolve) => (resolveStale = resolve))
      return Promise.resolve({ ok: true, models: [{ id: "gw/org-model", label: "Org Model", provider: "Kilo" }] })
    }

    const { host, find } = setup({
      onAuthChange: (listener) => {
        authListeners.add(listener)
        return () => void authListeners.delete(listener)
      },
    })

    // Start an initial fetch that stays in flight while auth switches.
    host.handle({ type: "speechToTextConfig" })
    await waitFor(() => fetches === 1, "first fetch started")

    // Auth changes while first fetch is still pending.
    triggerAuth()
    await waitFor(() => find("speechToTextConfigLoaded").length === 1, "post-auth status")
    expect(find("speechToTextConfigLoaded")[0]?.status).toMatchObject({ model: "gw/org-model" })

    // Resolving the stale first fetch must neither post nor overwrite the cache.
    resolveStale?.({ ok: true, models: [{ id: "gw/stale-model", label: "Stale", provider: "Kilo" }] })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(find("speechToTextConfigLoaded")).toHaveLength(1)

    host.handle({ type: "speechToTextConfig" })
    await waitFor(() => find("speechToTextConfigLoaded").length === 2, "cached org status")
    expect(fetches).toBe(2)
    expect(find("speechToTextConfigLoaded")[1]?.status).toMatchObject({ model: "gw/org-model" })

    // Dispose unsubscribes and prevents further pushes.
    host.dispose()
    expect(authListeners.size).toBe(0)
    triggerAuth()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(find("speechToTextConfigLoaded")).toHaveLength(2)
  })

  it("misses cache when signedIn state flips even before an auth event arrives", async () => {
    let fetches = 0
    state.fetchModels = async () => {
      fetches++
      return { ok: true, models: [{ id: `gw/model-${fetches}`, label: "Model", provider: "Kilo" }] }
    }
    state.signedIn = false
    const { host, find } = setup()

    host.handle({ type: "speechToTextConfig" })
    await waitFor(() => find("speechToTextConfigLoaded").length === 1, "signed-out status")
    expect(fetches).toBe(1)

    state.signedIn = true
    host.handle({ type: "speechToTextConfig" })
    await waitFor(() => find("speechToTextConfigLoaded").length === 2, "signed-in status")
    expect(fetches).toBe(2)
    expect(find("speechToTextConfigLoaded")[1]?.status).toMatchObject({
      enabled: true,
      signedIn: true,
      model: "gw/model-2",
    })
    host.dispose()
  })
})

describe("createSpeechAuthWatcher", () => {
  it("shares one host connection subscription across panels and filters auth, org, provider, and reconnect events", () => {
    let eventRegistrations = 0
    let stateRegistrations = 0
    let onEvent: ((event: unknown) => void) | undefined
    let onState: ((state: "connecting" | "connected" | "disconnected") => void) | undefined
    let currentState: "connecting" | "connected" | "disconnected" = "connected"

    const connection = {
      state: () => currentState,
      onEvent: (listener: (event: unknown) => void) => {
        eventRegistrations++
        onEvent = listener
        return () => {
          onEvent = undefined
        }
      },
      onState: (listener: (state: "connecting" | "connected" | "disconnected") => void) => {
        stateRegistrations++
        onState = listener
        return () => {
          onState = undefined
        }
      },
    }

    const watcher = createSpeechAuthWatcher(connection as never)
    let sidebarHits = 0
    let settingsHits = 0
    let otherDirHits = 0
    const unsubSidebar = watcher.subscribe("/repo", () => sidebarHits++)
    const unsubSettings = watcher.subscribe("/repo/", () => settingsHits++)
    const unsubOther = watcher.subscribe("/other", () => otherDirHits++)

    expect(eventRegistrations).toBe(1)
    expect(stateRegistrations).toBe(1)

    // Non-Kilo credential switches and unrelated events are ignored.
    onEvent?.({ type: "credential.switched", data: { integrationID: "anthropic", credentialID: "c1" } })
    onEvent?.({ type: "session.idle", data: { sessionID: "s1" } })
    expect([sidebarHits, settingsHits, otherDirHits]).toEqual([0, 0, 0])

    // Kilo credential switch and organization switch notify every open panel.
    onEvent?.({ type: "credential.switched", data: { integrationID: "kilo", credentialID: "c2" } })
    expect([sidebarHits, settingsHits, otherDirHits]).toEqual([1, 1, 1])

    onEvent?.({ type: "rpc.kilocode.gateway.organization", data: { organizationID: "org_1" } })
    expect([sidebarHits, settingsHits, otherDirHits]).toEqual([2, 2, 2])

    // Directory-scoped provider.updated only notifies panels for that directory.
    onEvent?.({ type: "provider.updated", location: { directory: "/repo" }, data: {} })
    expect([sidebarHits, settingsHits, otherDirHits]).toEqual([3, 3, 2])

    // Reconnect after a drop refreshes every open panel once connected again.
    currentState = "connecting"
    onState?.("connecting")
    expect([sidebarHits, settingsHits, otherDirHits]).toEqual([3, 3, 2])
    currentState = "connected"
    onState?.("connected")
    expect([sidebarHits, settingsHits, otherDirHits]).toEqual([4, 4, 3])
    // A duplicate connected transition without a prior drop does not fire again.
    onState?.("connected")
    expect([sidebarHits, settingsHits, otherDirHits]).toEqual([4, 4, 3])

    unsubSidebar()
    onEvent?.({ type: "credential.switched", data: { integrationID: "kilo", credentialID: null } })
    expect([sidebarHits, settingsHits, otherDirHits]).toEqual([4, 5, 4])

    unsubSettings()
    unsubOther()
    watcher.dispose()
    expect(onEvent).toBeUndefined()
    expect(onState).toBeUndefined()
  })
})
