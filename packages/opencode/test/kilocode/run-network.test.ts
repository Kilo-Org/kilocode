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

function asked(id: number): Event {
  return {
    type: "session.network.asked",
    properties: {
      sessionID: "ses_test",
      id: `req_${id}`,
      message: "Connection refused",
      time: { created: 0 },
    },
  }
}

function busy(): Event {
  return {
    type: "session.status",
    properties: {
      sessionID: "ses_test",
      status: { type: "busy" },
    },
  }
}

function idle(): Event {
  return {
    type: "session.status",
    properties: {
      sessionID: "ses_test",
      status: { type: "idle" },
    },
  }
}

function args() {
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
    auto: false,
    "--": [],
  }
}

const timer = globalThis.setTimeout
const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")

afterEach(() => {
  globalThis.setTimeout = timer
  if (tty) {
    Object.defineProperty(process.stdin, "isTTY", tty)
    return
  }
  delete (process.stdin as { isTTY?: boolean }).isTTY
})

function instant() {
  globalThis.setTimeout = ((cb: TimerHandler) => {
    if (typeof cb === "function") {
      queueMicrotask(() => cb())
    }
    return 0 as unknown as ReturnType<typeof setTimeout>
  }) as unknown as typeof setTimeout
}

async function run(sdk: Record<string, unknown>) {
  mock.module("@kilocode/sdk/v2", () => ({
    createKiloClient: () => sdk,
  }))

  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  })

  const key = JSON.stringify({ time: Date.now(), rand: Math.random() })
  const { RunCommand } = await import(`../../src/cli/cmd/run?${key}`)
  return RunCommand.handler(args() as never)
}

describe("cli run network retries", () => {
  test("rejects after repeated offline resumes without busy", async () => {
    instant()
    const q = feed<Event>()
    const calls: string[] = []
    const gate = Promise.withResolvers<void>()
    const state = { reject: undefined as string | undefined }

    const sdk = {
      config: {
        get: async () => ({ data: { share: "manual" } }),
      },
      event: {
        subscribe: async () => ({ stream: q.stream() }),
      },
      network: {
        reply: async (input: { requestID: string }) => {
          calls.push(input.requestID)
          q.push(asked(calls.length + 1))
        },
        reject: async (input: { requestID: string }) => {
          state.reject = input.requestID
          q.push(idle())
          q.end()
          gate.resolve()
        },
      },
      session: {
        prompt: async () => {
          q.push(asked(1))
          await gate.promise
          return { data: undefined }
        },
      },
    }

    await run(sdk)

    expect(calls).toStrictEqual(["req_1", "req_2", "req_3"])
    expect(state.reject).toBe("req_4")
  })

  test("resets retry budget only after the session is busy again", async () => {
    instant()
    const q = feed<Event>()
    const calls: string[] = []
    const gate = Promise.withResolvers<void>()
    const state = { reject: undefined as string | undefined }

    const sdk = {
      config: {
        get: async () => ({ data: { share: "manual" } }),
      },
      event: {
        subscribe: async () => ({ stream: q.stream() }),
      },
      network: {
        reply: async (input: { requestID: string }) => {
          calls.push(input.requestID)
          if (calls.length === 1) {
            q.push(busy())
            q.push(asked(2))
            return
          }
          if (calls.length < 4) {
            q.push(asked(calls.length + 1))
            return
          }
          q.push(idle())
          q.end()
          gate.resolve()
        },
        reject: async (input: { requestID: string }) => {
          state.reject = input.requestID
          q.push(idle())
          q.end()
          gate.resolve()
        },
      },
      session: {
        prompt: async () => {
          q.push(asked(1))
          await gate.promise
          return { data: undefined }
        },
      },
    }

    await run(sdk)

    expect(calls).toStrictEqual(["req_1", "req_2", "req_3", "req_4"])
    expect(state.reject).toBeUndefined()
  })
})
