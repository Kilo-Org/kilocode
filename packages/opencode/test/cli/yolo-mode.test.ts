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

function args(input?: { yolo?: boolean; auto?: boolean }) {
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
    yolo: input?.yolo ?? false,
    "--": [],
  }
}

const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")

afterEach(() => {
  mock.restore()
  if (tty) {
    Object.defineProperty(process.stdin, "isTTY", tty)
    return
  }
  delete (process.stdin as { isTTY?: boolean }).isTTY
})

async function run(input: { sdk: Record<string, unknown>; yolo?: boolean; auto?: boolean }) {
  mock.module("@kilocode/sdk/v2", () => ({
    createKiloClient: () => input.sdk,
  }))

  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  })

  const key = JSON.stringify({ time: Date.now(), rand: Math.random() })
  const { RunCommand } = await import(`../../src/cli/cmd/run?${key}`)
  return RunCommand.handler(args({ yolo: input.yolo, auto: input.auto }) as never)
}

describe("cli run YOLO mode", () => {
  test("--yolo auto-approves permission prompts", async () => {
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
      session: {
        prompt: async () => {
          q.push(permission("ses_test"))
          return { data: undefined }
        },
      },
    }

    await run({ sdk, yolo: true })

    expect(calls).toEqual([{ requestID: "perm_1", reply: "once" }])
  })

  test("without --yolo still rejects permission prompts by default", async () => {
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
      session: {
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
      session: {
        prompt: async () => {
          q.push(permission("ses_test"))
          return { data: undefined }
        },
      },
    }

    await run({ sdk, auto: true })

    expect(calls).toEqual([{ requestID: "perm_1", reply: "once" }])
  })
})
