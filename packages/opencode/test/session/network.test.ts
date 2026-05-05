// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionNetwork } from "../../src/session/network"
import { SessionID } from "../../src/session/schema"

describe("session.network", () => {
  test("detects common network disconnect codes", () => {
    expect(SessionNetwork.disconnected({ code: "ECONNREFUSED" })).toBe(true)
    expect(SessionNetwork.disconnected({ code: "ENOTFOUND" })).toBe(true)
    expect(SessionNetwork.disconnected({ code: "EAI_AGAIN" })).toBe(true)
    expect(SessionNetwork.disconnected({ code: "ENOENT" })).toBe(false)
  })

  test("detects provider unable to connect message", () => {
    const err = new Error("Unable to connect. Is the computer able to access the url?")
    expect(SessionNetwork.disconnected(err)).toBe(true)
    expect(SessionNetwork.message(err)).toBe("Unable to connect. Is the computer able to access the url?")
  })

  test("detects wrapped network cause", () => {
    const err = new Error("top") as Error & { cause?: unknown }
    err.cause = { code: "ETIMEDOUT" }
    expect(SessionNetwork.disconnected(err)).toBe(true)
    expect(SessionNetwork.message(err)).toBe("Connection timed out")
  })

  test("detects TimeoutError as disconnected", () => {
    const err = new DOMException("The operation was aborted due to timeout", "TimeoutError")
    expect(SessionNetwork.disconnected(err)).toBe(true)
    expect(SessionNetwork.message(err)).toBe("Request timed out")
  })

  test("detects wrapped TimeoutError in cause chain", () => {
    const timeout = new DOMException("signal timed out", "TimeoutError")
    const err = new Error("request failed", { cause: timeout })
    expect(SessionNetwork.disconnected(err)).toBe(true)
    expect(SessionNetwork.message(err)).toBe("Request timed out")
  })

  test("reply resolves pending request", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { promise } = await SessionNetwork.ask({
          sessionID: SessionID.make("ses_test"),
          message: "Connection refused",
          abort: new AbortController().signal,
        })
        const pending = await SessionNetwork.list()
        expect(pending).toHaveLength(1)
        const req = pending[0]!
        await SessionNetwork.reply({ requestID: req.id })
        await expect(promise).resolves.toBeUndefined()
      },
    })
  })

  test("reject rejects pending request", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { promise } = await SessionNetwork.ask({
          sessionID: SessionID.make("ses_test"),
          message: "Connection timed out",
          abort: new AbortController().signal,
        })
        const pending = await SessionNetwork.list()
        expect(pending).toHaveLength(1)
        const req = pending[0]!
        await SessionNetwork.reject({ requestID: req.id })
        await expect(promise).rejects.toBeInstanceOf(SessionNetwork.RejectedError)
      },
    })
  })

  test("aborted signal rejects without publishing asked", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const abort = new AbortController()
        const seen: string[] = []
        const offAsked = Bus.subscribe(SessionNetwork.Event.Asked, () => seen.push("asked"))
        const offRejected = Bus.subscribe(SessionNetwork.Event.Rejected, () => seen.push("rejected"))
        abort.abort()

        try {
          const { promise } = await SessionNetwork.ask({
            sessionID: SessionID.make("ses_test"),
            message: "Connection timed out",
            abort: abort.signal,
          })
          const err = await promise.catch((err) => err)

          expect(err).toBeInstanceOf(DOMException)
          expect(err.name).toBe("AbortError")
          expect(await SessionNetwork.list()).toHaveLength(0)
          expect(seen).toStrictEqual(["rejected"])
        } finally {
          offAsked()
          offRejected()
        }
      },
    })
  })

  test("abort during pending ask rejects with AbortError and cleans up", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const abort = new AbortController()
        const { promise } = await SessionNetwork.ask({
          sessionID: SessionID.make("ses_test"),
          message: "Connection refused",
          abort: abort.signal,
        })
        // wait for the ask to register
        const list = await SessionNetwork.list()
        expect(list).toHaveLength(1)

        // abort while waiting
        abort.abort()
        const err = await promise.catch((e: unknown) => e)
        expect(err).toBeInstanceOf(DOMException)
        expect((err as DOMException).name).toBe("AbortError")

        // pending entry should be cleaned up
        expect(await SessionNetwork.list()).toHaveLength(0)
      },
    })
  })
})
