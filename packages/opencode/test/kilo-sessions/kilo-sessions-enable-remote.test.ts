import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"

const state = {
  connects: 0,
  closes: 0,
  disposes: 0,
  userStatus: 200,
  gate: Promise.resolve(),
  userError: false,
}

mock.module("../../src/auth", () => ({
  OAUTH_DUMMY_KEY: "opencode-oauth-dummy-key",
  Auth: {
    get: async () => ({ type: "api", key: "tok" }),
  },
}))

mock.module("../../src/project/vcs", () => ({
  Vcs: {
    branch: async () => "main",
  },
}))

mock.module("simple-git", () => ({
  default: () => ({
    remote: async () => "origin\thttps://example.com/repo.git (fetch)",
  }),
}))

mock.module("../../src/kilo-sessions/remote-sender", () => ({
  RemoteSender: {
    create: () => ({
      handle() {},
      dispose() {
        state.disposes += 1
      },
    }),
  },
}))

mock.module("../../src/kilo-sessions/remote-ws", () => ({
  RemoteWS: {
    connect: () => {
      state.connects += 1
      return {
        connectionId: `conn-${state.connects}`,
        send() {},
        close() {
          state.closes += 1
        },
        get connected() {
          return true
        },
      }
    },
  },
}))

describe("KiloSessions.enableRemote", () => {
  beforeEach(() => {
    state.connects = 0
    state.closes = 0
    state.disposes = 0
    state.userStatus = 200
    state.gate = Promise.resolve()
    state.userError = false
    process.env["KILO_DISABLE_SESSION_INGEST"] = "0"
    delete process.env["KILO_SESSION_INGEST_URL"]
    globalThis.fetch = mock(async (input) => {
      await state.gate
      if (String(input).endsWith("/api/user")) {
        if (state.userError) throw new Error("network down")
        return new Response(null, { status: state.userStatus })
      }
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch
  })

  afterEach(async () => {
    const { KiloSessions } = await import("../../src/kilo-sessions/kilo-sessions")
    KiloSessions.disableRemote()
  })

  test("concurrent enableRemote shares one connection", async () => {
    await using tmp = await tmpdir({ git: true })
    const { Instance } = await import("../../src/project/instance")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { KiloSessions } = await import("../../src/kilo-sessions/kilo-sessions")
        await Promise.all([KiloSessions.enableRemote(), KiloSessions.enableRemote(), KiloSessions.enableRemote()])
        expect(state.connects).toBe(1)
        expect(KiloSessions.remoteStatus()).toEqual({ enabled: true, connected: true })
      },
    })
  })

  test("enableRemote fails when token is invalid", async () => {
    state.userStatus = 401
    await using tmp = await tmpdir({ git: true })
    const { Instance } = await import("../../src/project/instance")
    const { KiloSessions } = await import("../../src/kilo-sessions/kilo-sessions")
    const key = "kilo-sessions:token-valid:tok"
    const { clearInFlightCache } = await import("../../src/kilo-sessions/inflight-cache")

    KiloSessions.disableRemote()
    clearInFlightCache(key)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(KiloSessions.enableRemote()).rejects.toThrow(
          "Unable to enable remote: invalid or expired Kilo credentials. Run `kilo auth login`.",
        )
        expect(state.connects).toBe(0)
        expect(KiloSessions.remoteStatus()).toEqual({ enabled: false, connected: false })
      },
    })
  })

  test("disableRemote cancels in-flight enableRemote", async () => {
    let release = () => {}
    state.gate = new Promise<void>((resolve) => {
      release = resolve
    })

    await using tmp = await tmpdir({ git: true })
    const { Instance } = await import("../../src/project/instance")
    const { clearInFlightCache } = await import("../../src/kilo-sessions/inflight-cache")

    clearInFlightCache("kilo-sessions:token-valid:tok")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { KiloSessions } = await import("../../src/kilo-sessions/kilo-sessions")
        const pending = KiloSessions.enableRemote()
        KiloSessions.disableRemote()
        release()
        await pending
        expect(state.connects).toBe(1)
        expect(state.disposes).toBe(1)
        expect(state.closes).toBe(1)
        expect(KiloSessions.remoteStatus()).toEqual({ enabled: false, connected: false })
      },
    })
  })

  test("transient auth check failure is retryable and does not connect", async () => {
    state.userError = true
    await using tmp = await tmpdir({ git: true })
    const { Instance } = await import("../../src/project/instance")
    const { KiloSessions } = await import("../../src/kilo-sessions/kilo-sessions")
    const { clearInFlightCache } = await import("../../src/kilo-sessions/inflight-cache")

    KiloSessions.disableRemote()
    clearInFlightCache("kilo-sessions:token-valid:tok")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(KiloSessions.enableRemote()).rejects.toThrow(
          "Unable to enable remote: failed to verify Kilo credentials.",
        )
        expect(state.connects).toBe(0)
        expect(KiloSessions.remoteStatus()).toEqual({ enabled: false, connected: false })
      },
    })
  })

  test("disable then re-enable replaces stale pending connection", async () => {
    let release = () => {}
    state.gate = new Promise<void>((resolve) => {
      release = resolve
    })

    await using tmp = await tmpdir({ git: true })
    const { Instance } = await import("../../src/project/instance")
    const { clearInFlightCache } = await import("../../src/kilo-sessions/inflight-cache")

    clearInFlightCache("kilo-sessions:token-valid:tok")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { KiloSessions } = await import("../../src/kilo-sessions/kilo-sessions")
        const first = KiloSessions.enableRemote()
        KiloSessions.disableRemote()
        const second = KiloSessions.enableRemote()
        release()
        await Promise.all([first, second])
        expect(state.connects).toBe(2)
        expect(state.disposes).toBe(1)
        expect(state.closes).toBe(1)
        expect(KiloSessions.remoteStatus()).toEqual({ enabled: true, connected: true })
      },
    })
  })
})
