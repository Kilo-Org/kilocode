import { describe, expect, test } from "bun:test"
import { CodexAuthExpiredError, refreshCodexAuth } from "../../src/kilocode/provider/codex-refresh"
import { MessageV2 } from "../../src/session/message-v2"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { spawn } from "child_process"
import fs from "fs/promises"
import os from "os"
import path from "path"

type Auth = {
  type: "oauth"
  refresh: string
  access: string
  expires: number
  accountId?: string
}

type Lock = {
  staleMs: number
  timeoutMs: number
  baseDelayMs: number
  maxDelayMs: number
}

const expired = (): Auth => ({
  type: "oauth",
  access: "old-access",
  refresh: "old-refresh",
  expires: 0,
})

const root = path.join(import.meta.dir, "../..")
const worker = path.join(import.meta.dir, "fixture/codex-auth-refresh-worker.ts")

function plugin(persist: (auth: Auth) => void) {
  const set = async (req: { body: Auth }) => {
    persist(req.body)
  }
  return {
    client: {
      auth: { set },
    },
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function wait(file: string) {
  const stop = Date.now() + 10_000
  while (Date.now() < stop) {
    if (
      await fs
        .stat(file)
        .then(() => true)
        .catch(() => false)
    )
      return
    await sleep(10)
  }
  throw new Error(`Timed out waiting for file: ${file}`)
}

function run(input: { root: string; url: string; ready: string; start: string; lock?: Lock }) {
  const proc = spawn(process.execPath, [worker, JSON.stringify(input)], {
    cwd: root,
    windowsHide: true,
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  proc.stdout?.on("data", (data) => stdout.push(Buffer.from(data)))
  proc.stderr?.on("data", (data) => stderr.push(Buffer.from(data)))
  return {
    proc,
    done: new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      proc.on("close", (code) => {
        resolve({
          code: code ?? 1,
          stdout: Buffer.concat(stdout).toString(),
          stderr: Buffer.concat(stderr).toString(),
        })
      })
    }),
  }
}

async function race(input: { reuse: "early" | "late"; delay: number; lock?: Lock }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-auth-refresh-"))
  const calls: string[] = []
  const used = new Set<string>()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const body = new URLSearchParams(await req.text())
      const token = body.get("refresh_token")
      if (!token) return new Response("missing refresh token", { status: 400 })
      calls.push(token)
      if (used.has(token)) {
        if (input.reuse === "late") await sleep(input.delay + 50)
        return new Response("refresh token reused", { status: 401 })
      }
      used.add(token)
      await sleep(input.delay)
      return Response.json({
        id_token: "",
        access_token: "next-access",
        refresh_token: "next-refresh",
        expires_in: 60,
      })
    },
  })

  try {
    const data = path.join(dir, "share", "kilo")
    const start = path.join(dir, "start")
    const first = path.join(dir, "first")
    const second = path.join(dir, "second")
    await fs.mkdir(data, { recursive: true })
    await fs.writeFile(path.join(data, "auth.json"), JSON.stringify({ openai: expired() }))
    const url = `http://127.0.0.1:${server.port}/oauth/token`
    const a = run({ root: dir, url, ready: first, start, lock: input.lock })
    const b = run({ root: dir, url, ready: second, start, lock: input.lock })
    try {
      await Promise.all([wait(first), wait(second)])
      await fs.writeFile(start, "")
      const out = await Promise.all([a.done, b.done])
      return { calls, out }
    } finally {
      if (a.proc.exitCode === null) a.proc.kill()
      if (b.proc.exitCode === null) b.proc.kill()
    }
  } finally {
    await server.stop(true)
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe("Codex auth refresh", () => {
  test("serializes expired Codex auth as ProviderAuthError", () => {
    const result = MessageV2.fromError(new CodexAuthExpiredError(), { providerID: ProviderV2.ID.make("openai") })

    expect(result).toStrictEqual({
      name: "ProviderAuthError",
      data: {
        providerID: "openai",
        message:
          "Your ChatGPT sign-in expired or was revoked. Sign in with ChatGPT again to continue using Codex models.",
      },
    })
  })

  test("coalesces concurrent refreshes and persists rotated tokens", async () => {
    const calls: string[] = []
    const writes: Auth[] = []
    const first = expired()
    const second = expired()
    const refresh = async (token: string) => {
      calls.push(token)
      await new Promise((resolve) => setTimeout(resolve, 1))
      return { id_token: "", access_token: "next-access", refresh_token: "next-refresh", expires_in: 60 }
    }

    const [a, b] = await Promise.all([
      refreshCodexAuth({
        input: plugin((auth) => writes.push(auth)),
        getAuth: async () => first,
        auth: first,
        refresh,
        account: () => undefined,
      }),
      refreshCodexAuth({
        input: plugin((auth) => writes.push(auth)),
        getAuth: async () => second,
        auth: second,
        refresh,
        account: () => undefined,
      }),
    ])

    expect(calls).toEqual(["old-refresh"])
    expect(writes).toHaveLength(1)
    expect(a.access).toBe("next-access")
    expect(b.refresh).toBe("next-refresh")
    expect(first.access).toBe("next-access")
    expect(second.access).toBe("next-access")
  })

  test("uses a newer stored token after refresh 401", async () => {
    const fresh = {
      type: "oauth" as const,
      access: "fresh-access",
      refresh: "fresh-refresh",
      expires: Date.now() + 60_000,
    }
    const auth = expired()
    let count = 0
    const getAuth = async () => {
      count++
      return count === 1 ? auth : fresh
    }

    const result = await refreshCodexAuth({
      input: plugin(() => {}),
      getAuth,
      auth,
      refresh: async () => {
        throw new Error("Token refresh failed: 401")
      },
      account: () => undefined,
    })

    expect(result).toBe(fresh)
  })

  test("throws reauth error when refresh 401 has no newer stored token", async () => {
    const auth = expired()
    await expect(
      refreshCodexAuth({
        input: plugin(() => {}),
        getAuth: async () => auth,
        auth,
        refresh: async () => {
          throw new Error("Token refresh failed: 401")
        },
        account: () => undefined,
      }),
    ).rejects.toBeInstanceOf(CodexAuthExpiredError)
  })

  test("refreshes a newer stored token instead of the stale caller token", async () => {
    const auth = expired()
    const fresh = { ...expired(), refresh: "fresh-refresh", accountId: "account-1" }
    const calls: string[] = []

    const result = await refreshCodexAuth({
      input: plugin(() => {}),
      getAuth: async () => fresh,
      auth,
      refresh: async (token) => {
        calls.push(token)
        return { id_token: "", access_token: "next-access", refresh_token: "next-refresh", expires_in: 60 }
      },
      account: () => undefined,
    })

    expect(calls).toEqual(["fresh-refresh"])
    expect(result.accountId).toBe("account-1")
  })

  test("releases the lock and pending entry after a transient failure", async () => {
    const auth = expired()
    const calls: string[] = []
    const failed = await refreshCodexAuth({
      input: plugin(() => {}),
      getAuth: async () => auth,
      auth,
      refresh: async (token) => {
        calls.push(token)
        throw new Error("offline")
      },
      account: () => undefined,
    }).catch((err) => err)

    expect(failed).toEqual(new Error("offline"))

    await refreshCodexAuth({
      input: plugin(() => {}),
      getAuth: async () => auth,
      auth,
      refresh: async (token) => {
        calls.push(token)
        return { id_token: "", access_token: "next-access", refresh_token: "next-refresh", expires_in: 60 }
      },
      account: () => undefined,
    })

    expect(calls).toEqual(["old-refresh", "old-refresh"])
  })

  test("aborts a stalled refresh and releases the lock", async () => {
    const auth = expired()
    const calls: string[] = []
    const failed = await refreshCodexAuth({
      input: plugin(() => {}),
      getAuth: async () => auth,
      auth,
      refresh: async (token, signal) => {
        calls.push(token)
        return new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        })
      },
      account: () => undefined,
      timeout: 20,
    }).catch((err) => err)

    expect(failed).toBeInstanceOf(DOMException)
    expect(failed.name).toBe("TimeoutError")

    await refreshCodexAuth({
      input: plugin(() => {}),
      getAuth: async () => auth,
      auth,
      refresh: async (token) => {
        calls.push(token)
        return { id_token: "", access_token: "next-access", refresh_token: "next-refresh", expires_in: 60 }
      },
      account: () => undefined,
    })

    expect(calls).toEqual(["old-refresh", "old-refresh"])
  })

  test("serializes refreshes across processes before token reuse", async () => {
    for (const reuse of ["early", "late"] as const) {
      for (let trial = 0; trial < 5; trial++) {
        const result = await race({ reuse, delay: 100 })
        expect(result.calls).toEqual(["old-refresh"])
        expect(result.out.map((x) => x.code)).toEqual([0, 0])
        expect(result.out.map((x) => x.stderr)).toEqual(["", ""])
      }
    }
  }, 30_000)

  test("keeps the process lock alive during a delayed token response", async () => {
    const lock = {
      staleMs: 300,
      timeoutMs: 10_000,
      baseDelayMs: 20,
      maxDelayMs: 30,
    }
    const result = await race({ reuse: "early", delay: 1_000, lock })

    expect(result.calls).toEqual(["old-refresh"])
    expect(result.out.map((x) => x.code)).toEqual([0, 0])
    expect(result.out.map((x) => x.stderr)).toEqual(["", ""])
  }, 15_000)
})
