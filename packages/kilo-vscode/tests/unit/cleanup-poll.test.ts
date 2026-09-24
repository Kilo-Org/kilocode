import { afterEach, describe, expect, test } from "bun:test"
import { CleanupPoll } from "../../webview-ui/src/components/settings/cleanup"
import { failure } from "../../src/services/task-cleanup/failure"
import type { AutoCleanupStateLoadedMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

const polls: CleanupPoll[] = []
afterEach(() => polls.splice(0).forEach((poll) => poll.dispose()))

function fixture() {
  const sent: WebviewMessage[] = []
  const states: { message: AutoCleanupStateLoadedMessage; pending: boolean }[] = []
  const poll = new CleanupPoll(
    (message) => sent.push(message),
    (message, pending) => states.push({ message, pending }),
  )
  polls.push(poll)
  const reply = (index: number, data: Partial<AutoCleanupStateLoadedMessage> = {}) => {
    const request = sent.at(index)
    if (!request || !("requestID" in request)) throw new Error("Missing cleanup request")
    poll.receive({ type: "autoCleanupStateLoaded", last: null, requestID: request.requestID, ...data })
  }
  return { poll, sent, states, reply }
}

const progress = { phase: "deleting" as const, total: 12, processed: 7, deleted: 6, failed: 1, skippedActive: 2 }

describe("session cleanup polling", () => {
  test("classifies actual timeout errors without logging request secrets", async () => {
    const signal = AbortSignal.timeout(1)
    await Bun.sleep(10)
    expect(failure(signal.reason)).toEqual({ reason: "timeout", name: "TimeoutError" })
    const cause = Object.assign(new Error("private URL and credentials"), { code: "ECONNREFUSED" })
    expect(failure(new TypeError("private headers", { cause }))).toEqual({
      reason: "status",
      name: "TypeError",
      code: "ECONNREFUSED",
    })
    expect(failure({ headers: { authorization: "secret" } })).toEqual({ reason: "status", name: "UnknownError" })
  })

  test("timeout preserves real progress and pending state, then recovery clears the warning", async () => {
    const f = fixture()
    f.poll.start()
    f.reply(0, { pending: true, progress })
    f.poll.start()
    f.reply(1, { error: "timeout" })
    expect(f.states.at(-1)).toMatchObject({ pending: true, message: { progress, error: "timeout" } })
    await Bun.sleep(1100)
    expect(f.sent).toHaveLength(3)
    expect(f.sent.every((message) => message.type === "requestAutoCleanupState")).toBe(true)
    f.reply(2, { progress: { ...progress, processed: 8, deleted: 7 } })
    expect(f.states.at(-1)?.message.error).toBeUndefined()
    expect(f.states.at(-1)?.message.progress?.processed).toBe(8)
    f.poll.start()
    f.reply(3)
    expect(f.states.at(-1)?.message.progress).toBeUndefined()
    expect(f.states.at(-1)?.pending).toBe(false)
  })

  test("slow status never resubmits a manual run and a late completion clears the warning", () => {
    const f = fixture()
    f.poll.start()
    f.poll.execute()
    f.reply(0, { error: "timeout" })
    expect(f.states.at(-1)?.pending).toBe(true)
    f.poll.start()
    f.reply(1)
    expect(f.states.at(-1)?.pending).toBe(false)
    expect(f.states.at(-1)?.message.error).toBeUndefined()
    f.reply(2, { error: "timeout", pending: true })
    expect(f.states.at(-1)?.pending).toBe(false)
    expect(f.states.at(-1)?.message.error).toBeUndefined()
    expect(f.sent.filter((message) => message.type === "runAutoCleanupNow")).toHaveLength(1)
  })

  test("an idle status racing run startup does not clear the pending run", () => {
    const f = fixture()
    f.poll.start()
    f.poll.execute()
    f.reply(0)
    expect(f.states.at(-1)?.pending).toBe(true)
    f.reply(1)
    expect(f.states.at(-1)?.pending).toBe(false)
  })

  test("reopening settings uses backend counts and shared pending state", () => {
    const f = fixture()
    f.poll.start()
    f.reply(0, { pending: true, progress })
    expect(f.states.at(-1)).toMatchObject({ pending: true, message: { progress } })
    f.poll.start()
    f.reply(1)
    expect(f.states.at(-1)).toMatchObject({ pending: false, message: { last: null } })
  })

  test("ignores stale progress after completion without overlapping status requests", () => {
    const f = fixture()
    f.poll.start()
    f.poll.execute()
    f.reply(1)
    f.poll.start()
    expect(f.sent).toHaveLength(2)
    f.reply(0, { pending: true, progress })
    expect(f.states).toHaveLength(1)
    expect(f.states.at(-1)?.pending).toBe(false)
    expect(f.sent).toHaveLength(3)
  })

  test("errors settle manual requests and permit another run", () => {
    const f = fixture()
    f.poll.execute()
    f.reply(0, { error: "run" })
    expect(f.states.at(-1)?.pending).toBe(false)
    expect(f.states.at(-1)?.message.error).toBe("run")
    f.poll.start()
    f.reply(1)
    expect(f.states.at(-1)?.message.error).toBe("run")
    f.poll.execute()
    expect(f.sent).toHaveLength(3)
  })

  test("polls after responses, avoids duplicate requests, and stops on disposal", async () => {
    const f = fixture()
    f.poll.start()
    f.poll.start()
    expect(f.sent).toHaveLength(1)
    f.reply(0)
    await Bun.sleep(1100)
    expect(f.sent).toHaveLength(2)
    f.reply(1)
    f.poll.dispose()
    f.poll.start()
    f.poll.execute()
    f.reply(1, { progress })
    await Bun.sleep(1100)
    expect(f.sent).toHaveLength(2)
    expect(f.states).toHaveLength(2)
  })

  test("ignores replies from a previous mount and duplicate run clicks", () => {
    const old = fixture()
    old.poll.start()
    old.poll.dispose()
    const f = fixture()
    f.poll.start()
    const request = old.sent.at(0)
    if (!request || !("requestID" in request)) throw new Error("Missing cleanup request")
    f.poll.receive({ type: "autoCleanupStateLoaded", requestID: request.requestID, last: null, progress })
    expect(f.states).toHaveLength(0)
    f.poll.execute()
    f.poll.execute()
    expect(f.sent).toHaveLength(2)
  })

  test("stop posts once per running pass and never while idle", () => {
    const f = fixture()
    f.poll.stop()
    expect(f.sent).toHaveLength(0)
    f.poll.start()
    f.reply(0, { pending: true, progress })
    f.poll.stop()
    f.poll.stop()
    expect(f.sent.filter((message) => message.type === "stopAutoCleanupNow")).toHaveLength(1)
    const halt = f.sent.at(1)
    if (!halt || !("requestID" in halt)) throw new Error("Missing stop request")
    f.poll.receive({
      type: "autoCleanupStateLoaded",
      requestID: halt.requestID,
      last: null,
      progress: { ...progress, phase: "cancelling" },
    })
    expect(f.states.at(-1)?.message.progress?.phase).toBe("cancelling")
    // A later pass can be stopped again.
    f.poll.start()
    f.reply(2, { pending: true, progress })
    f.poll.stop()
    expect(f.sent.filter((message) => message.type === "stopAutoCleanupNow")).toHaveLength(2)
  })
})
