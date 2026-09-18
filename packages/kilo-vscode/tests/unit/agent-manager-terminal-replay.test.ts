import { describe, expect, it } from "bun:test"
import { createInputBuffer, createReplayGate, createWriteBatcher } from "../../webview-ui/agent-manager/terminal/replay"

describe("Agent Manager terminal write batcher", () => {
  const harness = (opts: { maxBytes?: number; stallFrames?: boolean } = {}) => {
    const writes: Array<string | Uint8Array> = []
    const cbs: Array<() => void> = []
    const pending = new Map<number, () => void>()
    const watchdog: Array<() => void> = []
    let next = 0
    const batcher = createWriteBatcher(
      (data, callback) => {
        writes.push(data)
        cbs.push(callback ?? (() => undefined))
      },
      opts.stallFrames
        ? () => 0xffff
        : (callback) => {
            const id = ++next
            pending.set(id, callback)
            return id
          },
      (id) => pending.delete(id),
      (callback) => {
        watchdog.push(callback)
        return watchdog.length
      },
      () => undefined,
      opts.maxBytes ?? 1024 * 1024,
    )
    return {
      batcher,
      writes,
      cbs,
      run: () => {
        const frames = [...pending.values()]
        pending.clear()
        for (const frame of frames) frame()
      },
      triggerWatchdog: () => watchdog.splice(0).forEach((frame) => frame()),
    }
  }

  it("joins one frame of text chunks into a single write", () => {
    const h = harness()
    h.batcher.write("a")
    h.batcher.write("b")
    h.batcher.write("c")
    expect(h.writes).toEqual([])
    h.run()
    expect(h.writes).toEqual(["abc"])
  })

  it("keeps local status output after pending PTY output", () => {
    const h = harness()
    h.batcher.write("last output")
    h.batcher.write("\r\n[terminal ended]\r\n")
    h.run()
    expect(h.writes).toEqual(["last output\r\n[terminal ended]\r\n"])
  })

  it("coalesces many frames into separate writes", () => {
    const h = harness()
    h.batcher.write("1")
    h.run()
    h.batcher.write("2")
    h.run()
    expect(h.writes).toEqual(["1", "2"])
  })

  it("merges binary control frames with text into one byte write", () => {
    const h = harness()
    h.batcher.write("txt")
    h.batcher.write(new Uint8Array([1, 2]))
    h.run()
    expect(h.writes).toHaveLength(2)
    expect(h.writes[0]).toBe("txt")
    expect(Array.from(h.writes[1] as Uint8Array)).toEqual([1, 2])
  })

  it("fires chunk callbacks after the batch write completes", () => {
    const h = harness()
    let done: string | undefined
    h.batcher.write("a", () => (done = "first"))
    h.batcher.write("b", () => (done = "second"))
    h.run()
    expect(h.cbs).toHaveLength(1)
    h.cbs[0]!()
    expect(done).toBe("second")
  })

  it("keeps the replay boundary sentinel callback after batch parse", () => {
    const h = harness()
    let boundary = false
    h.batcher.write("replay")
    h.batcher.write("", () => (boundary = true))
    h.run()
    expect(h.writes).toEqual(["replay"])
    h.cbs[0]!()
    expect(boundary).toBe(true)
  })

  it("cancel drops pending chunks and stops the scheduled flush", () => {
    const h = harness()
    h.batcher.write("a")
    h.batcher.cancel()
    h.run()
    expect(h.writes).toEqual([])
    h.batcher.write("b")
    h.run()
    expect(h.writes).toEqual(["b"])
  })

  it("flushes immediately when the byte cap is exceeded", () => {
    const h = harness({ maxBytes: 4 })
    h.batcher.write("ab")
    expect(h.writes).toEqual([])
    h.batcher.write("cd")
    expect(h.writes).toEqual(["abcd"])
  })

  it("watchdog drains the batch when animation frames stall", () => {
    const h = harness({ stallFrames: true })
    h.batcher.write("x")
    expect(h.writes).toEqual([])
    h.triggerWatchdog()
    expect(h.writes).toEqual(["x"])
  })
})

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

  it("clears buffered input after a failed replay", () => {
    const input = createInputBuffer()
    input.add("command\r")
    input.add("reply", true)
    input.clear()
    expect(input.take()).toBe("")
  })

  it("does not flush input when replay exceeds its limit", () => {
    let flushed = 0
    const gate = createReplayGate({ write: () => undefined, flush: () => flushed++ })
    gate.attach(false)
    expect(gate.output("x".repeat(8 * 1024 * 1024 + 1))).toBe(false)
    expect(flushed).toBe(0)
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
