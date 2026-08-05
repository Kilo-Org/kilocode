import { describe, expect, it } from "bun:test"
import { createInputBuffer, createReplayGate } from "../../webview-ui/agent-manager/terminal/replay"

describe("Agent Manager terminal input buffer", () => {
  it("sends parser replies first while preserving user input order", () => {
    const input = createInputBuffer()
    input.add("early ")
    input.add("reply", true)
    input.add("command\r")

    expect(input.take()).toBe("replyearly command\r")
    expect(input.take()).toBe("")
  })

  it("caps user input and protocol replies independently", () => {
    const input = createInputBuffer(4)
    input.add("12345")
    input.add("abcde", true)

    expect(input.take()).toBe("bcde2345")
  })
})

describe("Agent Manager terminal replay gate", () => {
  it("flushes initial input only after replay parsing completes", () => {
    const events: string[] = []
    let complete: (() => void) | undefined
    const gate = createReplayGate({
      write: (data, callback) => {
        events.push(typeof data === "string" ? data : `bytes:${data.join(",")}`)
        if (callback) complete = callback
      },
      flush: () => events.push("flush"),
    })

    gate.attach(false)
    expect(gate.blocked()).toBe(true)
    gate.output("replay")
    gate.output(new Uint8Array([1, 2, 3]))
    expect(events).toEqual([])
    expect(gate.frame(new Uint8Array([0, 123, 125]))).toBe(true)
    expect(gate.blocked()).toBe(true)
    expect(gate.draining()).toBe(true)
    expect(events).toEqual(["replay", "bytes:1,2,3", ""])

    complete?.()
    expect(gate.blocked()).toBe(false)
    expect(gate.draining()).toBe(false)
    expect(events).toEqual(["replay", "bytes:1,2,3", "", "flush"])
  })

  it("leaves reconnect input on the output-settle path", () => {
    const events: string[] = []
    const gate = createReplayGate({
      write: () => events.push("write"),
      flush: () => events.push("flush"),
    })

    gate.attach(true)
    expect(gate.blocked()).toBe(false)
    expect(gate.draining()).toBe(false)
    gate.output("live")
    expect(gate.frame(new Uint8Array([0]))).toBe(true)
    expect(events).toEqual(["write"])
  })

  it("consumes only one initial replay boundary", () => {
    let drains = 0
    const gate = createReplayGate({
      write: (_data, callback) => {
        if (callback) drains++
      },
      flush: () => undefined,
    })

    gate.attach(false)
    expect(gate.frame(new Uint8Array())).toBe(false)
    expect(gate.frame(new Uint8Array([0]))).toBe(true)
    expect(gate.frame(new Uint8Array([0]))).toBe(true)
    expect(drains).toBe(1)
  })

  it("ignores an initial parse callback after reconnect starts", () => {
    let complete: (() => void) | undefined
    let flushed = 0
    const gate = createReplayGate({
      write: (_data, callback) => {
        if (callback) complete = callback
      },
      flush: () => flushed++,
    })

    gate.attach(false)
    gate.frame(new Uint8Array([0]))
    gate.attach(true)
    complete?.()

    expect(gate.blocked()).toBe(false)
    expect(flushed).toBe(0)
  })

  it("lets terminal replies pass while queued replay parses before user input flushes", () => {
    const events: string[] = []
    let complete: (() => void) | undefined
    const gate = createReplayGate({
      write: (data, callback) => {
        events.push(String(data))
        if (callback) complete = callback
      },
      flush: () => events.push("flush"),
    })

    gate.attach(false)
    expect(gate.blocked()).toBe(true)
    gate.output("replay")
    gate.frame(new Uint8Array([0]))
    expect(gate.blocked()).toBe(true)
    expect(gate.draining()).toBe(true)
    gate.output("terminal-reply")
    expect(events).toEqual(["replay", "", "terminal-reply"])
    expect(complete).toBeFunction()
    complete?.()
    expect(gate.blocked()).toBe(false)
    expect(gate.draining()).toBe(false)
    expect(events).toEqual(["replay", "", "terminal-reply", "flush"])
  })

  it("keeps user input blocked for the complete parser-drain window", () => {
    let complete: (() => void) | undefined
    const gate = createReplayGate({
      write: (_data, callback) => {
        if (callback) complete = callback
      },
      flush: () => undefined,
    })

    gate.attach(false)
    gate.frame(new Uint8Array([0]))
    expect(gate.blocked()).toBe(true)
    expect(gate.draining()).toBe(true)

    complete?.()
    expect(gate.blocked()).toBe(false)
    expect(gate.draining()).toBe(false)
  })
})
