// kilocode_change - new file
import { afterEach, describe, expect, mock, test } from "bun:test"

type Event = {
  type: string
  properties: Record<string, unknown>
}

function feed<T>() {
  const list: T[] = []
  const wait: Array<() => void> = []
  const state = { done: false }

  return {
    push(item: T) {
      list.push(item)
      while (wait.length) wait.shift()?.()
    },
    end() {
      state.done = true
      while (wait.length) wait.shift()?.()
    },
    async *stream() {
      while (!state.done || list.length) {
        if (list.length) {
          yield list.shift() as T
          continue
        }
        await new Promise<void>((resolve) => wait.push(resolve))
      }
    },
  }
}

function permission(sessionID: string): Event {
  return {
    type: "permission.asked",
    properties: {
      sessionID,
      id: "perm_1",
      permission: "bash",
      patterns: ["pwd"],
      metadata: {},
      always: [],
      time: { created: 0 },
    },
  }
}

function idle(sessionID: string): Event {
  return {
    type: "session.status",
    properties: {
      sessionID,
      status: { type: "idle" },
    },
  }
}

function args(input?: { autoApprove?: boolean; auto?: boolean }) {
  return {
    _: [],
    $0: "kilo",
    message: ["hi"],
    command: undefined,
    continue: false,
    session: "ses_test",
    fork: false,
    "cloud-fork": false,
    cloudFork: false,
    share: false,
    model: undefined,
    agent: undefined,
    format: "default",
    file: undefined,
    title: undefined,
    attach: "http://127.0.0.1:4096",
    password: undefined,
    dir: undefined,
    port: undefined,
    variant: undefined,
    thinking: false,
    auto: input?.auto ?? false,
    "auto-approve": input?.autoApprove ?? false,
    autoApprove: input?.autoApprove ?? false,
    "--": [],
  }
}

const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")

// mock.restore() does NOT reset mock.module overrides (oven-sh/bun#7823).
// Reset the SDK mock to a sentinel so the next test starts from a known state.
afterEach(() => {
  mock.module("@kilocode/sdk/v2", () => ({ createKiloClient: undefined }))
  mock.restore()
  if (tty) {
    Object.defineProperty(process.stdin, "isTTY", tty)
    return
  }
  delete (process.stdin as { isTTY?: boolean }).isTTY
})

async function run(input: { sdk: Record<string, unknown>; autoApprove?: boolean; auto?: boolean }) {
  mock.module("@kilocode/sdk/v2", () => ({
    createKiloClient: () => input.sdk,
  }))

  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  })

  const key = JSON.stringify({ time: Date.now(), rand: Math.random() })
  const { RunCommand } = await import(`../../src/cli/cmd/run?${key}`)
  return RunCommand.handler(args({ autoApprove: input.autoApprove, auto: input.auto }) as never)
}

describe("cli run auto-approve mode", () => {
  test("--auto-approve auto-approves permission prompts", async () => {
    const q = feed<Event>()
    const calls: Array<{ requestID: string; reply: string }> = []

    const sdk = {
      config: {
        get: async () => ({ data: { share: "manual" } }),
      },
      event: {
        subscribe: async () => ({ stream: q.stream() }),
      },
      permission: {
        reply: async (input: { requestID: string; reply: string }) => {
          calls.push(input)
          q.push(idle("ses_test"))
          q.end()
          return { data: true }
        },
      },
      path: {
        get: async () => ({ data: { directory: process.cwd() } }),
      },
      session: {
        get: async () => ({ data: { id: "ses_test" } }),
        prompt: async () => {
          q.push(permission("ses_test"))
          return { data: undefined }
        },
      },
    }

    await run({ sdk, autoApprove: true })

    expect(calls).toEqual([{ requestID: "perm_1", reply: "once" }])
  })

  test("without --auto-approve still rejects permission prompts by default", async () => {
    const q = feed<Event>()
    const calls: Array<{ requestID: string; reply: string }> = []

    const sdk = {
      config: {
        get: async () => ({ data: { share: "manual" } }),
      },
      event: {
        subscribe: async () => ({ stream: q.stream() }),
      },
      permission: {
        reply: async (input: { requestID: string; reply: string }) => {
          calls.push(input)
          q.push(idle("ses_test"))
          q.end()
          return { data: true }
        },
      },
      path: {
        get: async () => ({ data: { directory: process.cwd() } }),
      },
      session: {
        get: async () => ({ data: { id: "ses_test" } }),
        prompt: async () => {
          q.push(permission("ses_test"))
          return { data: undefined }
        },
      },
    }

    await run({ sdk })

    expect(calls).toEqual([{ requestID: "perm_1", reply: "reject" }])
  })

  test("--auto still auto-approves permission prompts", async () => {
    const q = feed<Event>()
    const calls: Array<{ requestID: string; reply: string }> = []

    const sdk = {
      config: {
        get: async () => ({ data: { share: "manual" } }),
      },
      event: {
        subscribe: async () => ({ stream: q.stream() }),
      },
      permission: {
        reply: async (input: { requestID: string; reply: string }) => {
          calls.push(input)
          q.push(idle("ses_test"))
          q.end()
          return { data: true }
        },
      },
      path: {
        get: async () => ({ data: { directory: process.cwd() } }),
      },
      session: {
        get: async () => ({ data: { id: "ses_test" } }),
        prompt: async () => {
          q.push(permission("ses_test"))
          return { data: undefined }
        },
      },
    }

    await run({ sdk, auto: true })

    expect(calls).toEqual([{ requestID: "perm_1", reply: "once" }])
  })

  test("--auto-approve does not install wildcard permission rule", async () => {
    const captures: Array<{ permission?: unknown }> = []
    const q = feed<Event>()

    const sdk = {
      config: {
        get: async () => ({ data: { share: "manual" } }),
      },
      event: {
        subscribe: async () => ({ stream: q.stream() }),
      },
      permission: {
        reply: async () => ({ data: true }),
      },
      path: {
        get: async () => ({ data: { directory: process.cwd() } }),
      },
      session: {
        create: async (input: { permission?: unknown }) => {
          captures.push(input)
          // End the event stream so downstream loops can unwind cleanly.
          q.end()
          return { data: { id: "ses_new" } }
        },
        list: async () => ({ data: [] }),
        get: async () => ({ data: { id: "ses_new" } }),
        fork: async () => ({ data: { id: "ses_new" } }),
        share: async () => ({ data: undefined }),
        prompt: async () => ({ data: undefined }),
        command: async () => ({ data: undefined }),
        message: {
          list: async () => ({ data: [] }),
        },
      },
      app: {
        agents: async () => ({ data: [] }),
      },
      network: {
        reply: async () => ({ data: true }),
        reject: async () => ({ data: true }),
      },
    }

    mock.module("@kilocode/sdk/v2", () => ({
      createKiloClient: () => sdk,
    }))

    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    })

    // INTENTIONALLY OMIT `session` and `continue` so run.ts reaches
    // sdk.session.create (lines 534 / 570) with the rules array. The existing
    // args() helper sets session: "ses_test" which makes run.ts return at line
    // 468 before session.create is ever called — which is exactly what the
    // three prior tests do, so they cannot observe the permission payload.
    const customArgs = {
      _: [],
      $0: "kilo",
      message: ["hi"],
      command: undefined,
      continue: false,
      fork: false,
      "cloud-fork": false,
      cloudFork: false,
      share: false,
      model: undefined,
      agent: undefined,
      format: "default",
      file: undefined,
      title: undefined,
      attach: "http://127.0.0.1:4096",
      password: undefined,
      dir: undefined,
      port: undefined,
      variant: undefined,
      thinking: false,
      auto: false,
      "auto-approve": true,
      autoApprove: true,
      "--": [],
    }

    const key = JSON.stringify({ time: Date.now(), rand: Math.random() })
    const { RunCommand } = await import(`../../src/cli/cmd/run?${key}`)

    try {
      await RunCommand.handler(customArgs as never)
    } catch {
      // Expected: downstream calls (pickAgent, interactive runtime, etc.) may
      // fail without full mocks. The important assertion is that
      // session.create was reached before any failure.
    }

    expect(captures.length).toBeGreaterThan(0)
    const captured = captures[0]
    expect(captured.permission).toBeDefined()
    const permRules = Array.isArray(captured.permission) ? captured.permission : []
    const wildcards = (permRules as Array<{ permission?: string; action?: string }>).filter(
      (r) => r.permission === "*" && r.action === "allow",
    )
    expect(wildcards).toHaveLength(0)
  })
})
