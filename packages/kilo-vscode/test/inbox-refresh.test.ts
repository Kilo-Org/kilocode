import { afterEach, beforeEach, expect, jest, test } from "bun:test"
import { setImmediate } from "node:timers/promises"
import { OpenCode } from "@opencode/client"
import { createData } from "@opencode/client/solid"
import { createRoot, getOwner, runWithOwner } from "solid-js"
import { events } from "../webview-ui/src/v2/events"
import { createInboxRefresh } from "../webview-ui/src/v2/inbox-refresh"

const sessionID = "ses_test"
const queued = {
  id: "msg_queued",
  sessionID,
  time: { created: 1 },
  type: "user",
  payload: { text: "A queued prompt" },
  delivery: "queue",
} as const

function fixture(respond: () => Response) {
  const requests: string[] = []
  const api = OpenCode.make({
    baseUrl: "http://kilo.invalid",
    fetch: Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        const request = new Request(...args)
        requests.push(`${request.method} ${new URL(request.url).pathname}`)
        return respond()
      },
      { preconnect: fetch.preconnect },
    ),
  })
  return createRoot((dispose) => {
    const owner = getOwner()
    const data = createData({ api: () => api, directory: "/workspace", event: events() })
    const inbox = createInboxRefresh(data.session.pending.sync)
    return {
      inbox,
      requests,
      pending: () => data.session.pending.list(sessionID),
      sync: () => runWithOwner(owner, () => inbox.sync(sessionID)),
      [Symbol.dispose]: dispose,
    }
  })
}

function timeout(): never {
  throw new TypeError("connect ETIMEDOUT 127.0.0.1:58408")
}

async function advanceRetry() {
  // Let the rejection pass through the generated client and data store before moving the fake clock.
  await setImmediate()
  jest.advanceTimersToNextTimer()
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test("a transient inbox timeout retries without publishing a banner and hydrates queued prompts", async () => {
  let attempts = 0
  using setup = fixture(() => (++attempts === 1 ? timeout() : Response.json({ data: [queued] })))
  const refresh = setup.sync()
  await setImmediate()
  expect(setup.requests).toHaveLength(1)
  expect(setup.inbox.failure()).toBeUndefined()
  jest.advanceTimersToNextTimer()
  await refresh

  expect(setup.requests).toEqual(["GET /api/session/ses_test/inbox", "GET /api/session/ses_test/inbox"])
  expect(setup.pending()).toEqual([queued])
  expect(setup.inbox.failure()).toBeUndefined()
})

test("the retry budget is bounded and a subsequent inbox sync clears its own failure", async () => {
  let reachable = false
  using setup = fixture(() => (reachable ? Response.json({ data: [queued] }) : timeout()))
  const refresh = setup.sync()
  await advanceRetry()
  expect(setup.inbox.failure()).toBeUndefined()
  await advanceRetry()
  await refresh

  expect(setup.requests).toHaveLength(3)
  expect(setup.inbox.failure()?.details).toContain("ETIMEDOUT")

  reachable = true
  await setup.sync()
  expect(setup.requests).toHaveLength(4)
  expect(setup.pending()).toEqual([queued])
  expect(setup.inbox.failure()).toBeUndefined()
})

test("a non-transport failure still reaches the session load's error handler without retrying", async () => {
  using setup = fixture(() => new Response(null, { status: 500 }))
  await expect(setup.sync()).rejects.toThrow("UnexpectedStatus: 500")

  expect(setup.requests).toHaveLength(1)
  expect(setup.inbox.failure()).toBeUndefined()
})

test("leaving a session ends a scheduled retry without publishing a late failure", async () => {
  const setup = fixture(timeout)
  const refresh = setup.sync()
  await setImmediate()
  setup[Symbol.dispose]()
  jest.runAllTimers()
  await refresh

  expect(setup.requests).toHaveLength(1)
  expect(setup.inbox.failure()).toBeUndefined()
})
