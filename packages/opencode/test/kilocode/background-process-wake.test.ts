// kilocode_change - new file
//
// Regression tests for background process wake detection.
//
// Two layers of coverage:
//  1. Unit tests against `WakeEngine` directly, exercising cross-chunk line
//     buffering, FIFO queueing, cooldown semantics, UTF-8 byte splits, CRLF,
//     queue bounds, and process exit flushes.
//  2. Integration tests using a real child process that emits JSON events,
//     validating that complete events cross chunk boundaries are surfaced to
//     `fireWakeBatch` exactly once and in order.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as WakeEngine from "@/kilocode/background-process/wake"
import { BackgroundProcess } from "@/kilocode/background-process"
import { SessionID } from "@/session/schema"
import { Shell } from "@opencode-ai/core/shell"
import path from "path"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

function quote(input: string) {
  const value = input.replaceAll("\\", "/")
  if (process.platform === "win32") return `"${value.replaceAll('"', '""')}"`
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function script(dir: string, name: string, source: string, exec = process.execPath) {
  const file = path.join(dir, name)
  await Bun.write(file, source)
  const bin = quote(exec)
  const arg = quote(file)
  if (Shell.ps(Shell.acceptable())) return `& ${bin} ${arg}`
  return `${bin} ${arg}`
}

async function asyncWait(check: () => boolean | Promise<boolean>, message: string, timeout = 5_000): Promise<void> {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check()) return
    await Bun.sleep(20)
  }
  throw new Error(message)
}

describe("WakeEngine line buffering", () => {
  test("A: single JSON event split across two chunks surfaces on the second chunk", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /"type":"generate"/,
      cooldownMs: 60_000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    WakeEngine.feed(state, "stdout", Buffer.from('{"type":"gene', "utf8"))
    expect(state.queue).toEqual([])
    expect(state.fired).toBe(0)

    WakeEngine.feed(state, "stdout", Buffer.from('rate","id":"evt-1"}\n', "utf8"))
    await asyncWait(() => state.queue.length === 0 && state.fired === 1, "first event did not fire")
    expect(fired).toEqual([['{"type":"generate","id":"evt-1"}']])
  })

  test("B: single event split across multiple chunks stitches into one complete event", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /"type":"generate"/,
      cooldownMs: 60_000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    for (const piece of ['{"type":', '"gene', 'rate",', '"id":"1"}\n']) {
      WakeEngine.feed(state, "stdout", Buffer.from(piece, "utf8"))
    }
    await asyncWait(() => state.fired === 1, "stitched event did not fire")
    expect(fired).toEqual([['{"type":"generate","id":"1"}']])
    expect(state.fired).toBe(1)
  })

  test("C: chunk with multiple complete events matches each one in order, no event lost", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /"type":"(generate|steer|accept)"/,
      cooldownMs: 0,
      batchMax: 1000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    const body = '{"type":"generate","id":"1"}\n{"type":"steer","id":"2"}\n{"type":"accept","id":"3"}\n'
    WakeEngine.feed(state, "stdout", Buffer.from(body, "utf8"))
    // All three events are matched and reach the FIFO; with batchMax=1000 and
    // cooldownMs=0 they coalesce into a single dispatch. The order is what
    // matters, not the number of dispatch calls.
    await asyncWait(() => state.fired === 3, `expected 3 fires, got ${state.fired}`)
    const flat = fired.flat()
    expect(flat).toEqual([
      '{"type":"generate","id":"1"}',
      '{"type":"steer","id":"2"}',
      '{"type":"accept","id":"3"}',
    ])
  })

  test("D: complete and incomplete lines in mixed chunks deliver only complete matches in order", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /"type":"(generate|steer)"/,
      cooldownMs: 0,
      batchMax: 1000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    WakeEngine.feed(state, "stdout", Buffer.from('{"type":"generate","id":"1"}\n{"type":"ste', "utf8"))
    await asyncWait(() => state.fired === 1, "first complete event did not fire")
    expect(fired).toEqual([['{"type":"generate","id":"1"}']])
    WakeEngine.feed(state, "stdout", Buffer.from('er","id":"2"}\n', "utf8"))
    await asyncWait(() => state.fired === 2, "second complete event did not fire")
    expect(fired).toEqual([
      ['{"type":"generate","id":"1"}'],
      ['{"type":"steer","id":"2"}'],
    ])
  })

  test("E: stdout and stderr hold independent line buffers; stderr does not pollute stdout", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /"type":"generate"|warning/,
      cooldownMs: 0,
      batchMax: 1,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    WakeEngine.feed(state, "stdout", Buffer.from('{"type":"gene', "utf8"))
    WakeEngine.feed(state, "stderr", Buffer.from("warning: something\n", "utf8"))
    WakeEngine.feed(state, "stdout", Buffer.from('rate","id":"1"}\n', "utf8"))
    await asyncWait(() => state.fired === 2, "expected warnings + json to fire", 1000)
    expect(fired).toEqual([["warning: something"], ['{"type":"generate","id":"1"}']])
  })

  test("F: process exit flush delivers a final event without a trailing newline exactly once", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /"type":"exit"/,
      cooldownMs: 60_000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    WakeEngine.feed(state, "stdout", Buffer.from('{"type":"exit","token":"abc"}', "utf8"))
    expect(state.fired).toBe(0)

    WakeEngine.flush(state)
    await WakeEngine.flushDispatch(state)
    await asyncWait(() => state.fired === 1, "exit event did not fire")

    expect(fired).toEqual([['{"type":"exit","token":"abc"}']])
    expect(state.fired).toBe(1)

    // A second flush must NOT re-emit.
    WakeEngine.flush(state)
    await WakeEngine.flushDispatch(state)
    expect(state.fired).toBe(1)
  })

  test("G: CRLF line endings are handled, with the carriage return stripped", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /"type":"generate"/,
      cooldownMs: 60_000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    WakeEngine.feed(state, "stdout", Buffer.from('{"type":"generate","id":"1"}\r\n', "utf8"))
    await asyncWait(() => state.fired === 1, "CRLF event did not fire")
    expect(fired).toEqual([['{"type":"generate","id":"1"}']])
    expect(fired[0][0].endsWith("\r")).toBe(false)
  })

  test("G/2: CRLF split across two chunks is still detected", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /"type":"generate"/,
      cooldownMs: 60_000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    WakeEngine.feed(state, "stdout", Buffer.from('{"type":"generate","id":"1"}\r', "utf8"))
    WakeEngine.feed(state, "stdout", Buffer.from("\n", "utf8"))
    await asyncWait(() => state.fired === 1, "split CRLF event did not fire")
    expect(fired).toEqual([['{"type":"generate","id":"1"}']])
  })

  test("H: UTF-8 multi-byte character split across chunks is decoded intact", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /"type":"steer"/,
      cooldownMs: 60_000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    const full = Buffer.from('{"type":"steer","message":"修改页面布局"}\n', "utf8")
    // 修 is U+4FEE, encoded as 0xE4 0xBF 0xAE.
    const splitIndex = full.indexOf(Buffer.from([0xbf])) // middle byte of 修
    expect(splitIndex).toBeGreaterThan(0)

    const left = full.subarray(0, splitIndex)
    const right = full.subarray(splitIndex)
    WakeEngine.feed(state, "stdout", left)
    WakeEngine.feed(state, "stdout", right)
    await asyncWait(() => state.fired === 1, "UTF-8 split event did not fire")
    expect(fired).toEqual([['{"type":"steer","message":"修改页面布局"}']])
    expect(fired[0][0]).not.toContain("\ufffd")
  })

  test("I: unbounded no-newline input enters drop-mode; memory bounded; no fragment is matched", async () => {
    const fired: string[][] = []
    const overflowed: string[] = []
    const state = WakeEngine.createWake({
      pattern: /trigger/,
      cooldownMs: 0,
      batchMax: 1000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
      log: (level, message) => {
        if (level === "warn" && message.includes("exceeded max length")) overflowed.push(message)
      },
    })

    // Feed in pieces, none of which ends in a newline, totalling well above
    // the per-line cap. The trailing partial buffer must stay bounded and
    // drop-mode must be entered.
    const perChunk = 8 * 1024
    const huge = "x".repeat(WakeEngine.MAX_WAKE_LINE_BYTES * 2)
    for (let offset = 0; offset < huge.length; offset += perChunk) {
      WakeEngine.feed(state, "stdout", Buffer.from(huge.slice(offset, offset + perChunk), "utf8"))
    }
    // The buffered tail must stay bounded and the engine must have entered
    // drop-mode for stdout.
    expect(Buffer.byteLength(state.buffer.stdout, "utf8")).toBeLessThanOrEqual(WakeEngine.MAX_WAKE_LINE_BYTES)
    expect(state.dropping.stdout).toBe(true)
    expect(state.droppedLines).toBe(1)
    expect(overflowed.length).toBe(1)
    expect(state.overflowed).toBe(true)

    // No event was fired while the overlong line was being accumulated.
    expect(fired).toEqual([])

    // Send a chunk that finishes the dropped line (with a newline) and then
    // contains a new, well-formed line. The dropped portion (including any
    // text before the newline) is discarded; the new line fires.
    WakeEngine.feed(
      state,
      "stdout",
      Buffer.from(`x\n{"type":"trigger","id":"1"}\n`, "utf8"),
    )
    await asyncWait(() => state.fired === 1, "post-drop event did not fire")
    expect(state.dropping.stdout).toBe(false)
    expect(fired.flat()).toEqual(['{"type":"trigger","id":"1"}'])
    expect(fired.flat().some((line) => /\u2026/.test(line))).toBe(false)
  })

  test("J: dispose cancels pending timers and prevents further fire", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /trigger/,
      cooldownMs: 60_000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    WakeEngine.feed(state, "stdout", Buffer.from("trigger\n", "utf8"))
    WakeEngine.dispose(state)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(fired).toEqual([])
    expect(state.queue).toEqual([])
    expect(state.disposed).toBe(true)
  })

  // ------------------------------------------------------------------
  // Drop-mode regression tests (per-line, not per-chunk, overlong handling).
  // The previous implementation kept a sliding window of the last
  // `MAX_WAKE_LINE_BYTES` and ran the pattern on the truncated tail. That
  // was unsafe: a fragment of a JSON line could match the pattern and
  // wake the agent on a false positive. The current policy is drop-mode:
  // any single line whose UTF-8 byte length exceeds `MAX_WAKE_LINE_BYTES`
  // is discarded entirely, with a single warning, until the producer
  // signals the line's end with `\n`. Subsequent lines on the same stream
  // are processed normally.
  // ------------------------------------------------------------------

  test("drop-mode A: a single chunk with >100 short events is processed line-by-line", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /"type":"event"/,
      cooldownMs: 0,
      batchMax: 1000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    // Build a chunk whose TOTAL size is well above `MAX_WAKE_LINE_BYTES`
    // but where every individual line stays under the cap. We pad each
    // event with a long JSON field so 200 lines already exceed the cap.
    const count = 200
    const pad = "x".repeat(400)
    const body: string[] = []
    for (let i = 0; i < count; i++) {
      body.push(`{"type":"event","id":${i},"pad":"${pad}"}`)
    }
    const chunk = body.join("\n") + "\n"
    expect(Buffer.byteLength(chunk, "utf8")).toBeGreaterThan(WakeEngine.MAX_WAKE_LINE_BYTES)
    // Sanity-check the spec assumption: no single line crosses the cap.
    for (const line of body) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(WakeEngine.MAX_WAKE_LINE_BYTES)
    }

    WakeEngine.feed(state, "stdout", Buffer.from(chunk, "utf8"))
    await asyncWait(() => state.fired === count, `expected ${count} fires, got ${state.fired}`)
    const flat = fired.flat()
    expect(flat.length).toBe(count)
    for (let i = 0; i < count; i++) {
      expect(flat[i]).toBe(body[i])
    }
    expect(state.dropping.stdout).toBe(false)
    expect(state.droppedLines).toBe(0)
  })

  test("drop-mode B: a single overlong line is dropped entirely; one warning", async () => {
    const fired: string[][] = []
    const warnings: { message: string; meta: unknown }[] = []
    const state = WakeEngine.createWake({
      pattern: /"type":"x"/,
      cooldownMs: 0,
      batchMax: 1000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
      log: (level, message, meta) => {
        if (level === "warn") warnings.push({ message, meta })
      },
    })

    const overlong = '{"type":"x","pad":"' + "y".repeat(WakeEngine.MAX_WAKE_LINE_BYTES) + '"}'
    WakeEngine.feed(state, "stdout", Buffer.from(overlong + "\n", "utf8"))

    expect(state.dropping.stdout).toBe(false)
    expect(state.droppedLines).toBe(1)
    expect(fired).toEqual([])
    expect(warnings.length).toBe(1)
    expect(warnings[0].message).toContain("exceeded max length")
    expect(warnings[0].message).not.toContain("y".repeat(50))
  })

  test("drop-mode C: overlong line split across many chunks drops each piece until the newline", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /"type":"x"/,
      cooldownMs: 0,
      batchMax: 1000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    const overlong = '{"type":"x","pad":"' + "y".repeat(WakeEngine.MAX_WAKE_LINE_BYTES * 2) + '"}'
    const parts = ["\"" + overlong.slice(1, 30_000), overlong.slice(30_000, 80_000), overlong.slice(80_000) + "\n"]

    for (const part of parts) {
      WakeEngine.feed(state, "stdout", Buffer.from(part, "utf8"))
    }
    expect(state.droppedLines).toBe(1)
    expect(state.dropping.stdout).toBe(false)
    expect(fired).toEqual([])

    // A normal line in a fresh chunk fires.
    WakeEngine.feed(state, "stdout", Buffer.from('{"type":"x","id":"next"}\n', "utf8"))
    await asyncWait(() => state.fired === 1, "post-drop event did not fire")
    expect(fired[0][0]).toContain('"id":"next"')
  })

  test("drop-mode D: an overlong line followed by normal events in the same chunk", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /"type":"(generate|exit)"/,
      cooldownMs: 0,
      batchMax: 1000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    const overlong = '{"type":"x","pad":"' + "y".repeat(WakeEngine.MAX_WAKE_LINE_BYTES) + '"}\n'
    const chunk = overlong + '{"type":"generate","id":"2"}\n{"type":"exit","token":"3"}\n'
    WakeEngine.feed(state, "stdout", Buffer.from(chunk, "utf8"))

    // Both events must fire in the original order; the overlong line is dropped.
    await asyncWait(() => state.fired === 2, "post-drop events did not fire")
    expect(fired.flat()).toEqual(['{"type":"generate","id":"2"}', '{"type":"exit","token":"3"}'])
    expect(state.droppedLines).toBe(1)
  })

  test("drop-mode E: stdout in drop-mode does not affect stderr", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /"type":"(generate|warning)"/,
      cooldownMs: 0,
      batchMax: 1000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    // stdout: long line that drops, then a normal event
    const overlong = '{"type":"x","pad":"' + "y".repeat(WakeEngine.MAX_WAKE_LINE_BYTES) + '"}\n'
    WakeEngine.feed(state, "stdout", Buffer.from(overlong, "utf8"))
    WakeEngine.feed(state, "stdout", Buffer.from('{"type":"generate","id":"1"}\n', "utf8"))

    // stderr: independent normal event, must not be impacted by stdout drop-mode
    WakeEngine.feed(state, "stderr", Buffer.from('{"type":"warning","msg":"low memory"}\n', "utf8"))

    expect(state.dropping.stdout).toBe(false)
    expect(state.dropping.stderr).toBe(false)
    expect(state.droppedLines).toBe(1)
    await asyncWait(() => state.fired === 2, "stderr event was lost due to stdout drop-mode")
    const flat = fired.flat()
    expect(flat).toEqual(['{"type":"generate","id":"1"}', '{"type":"warning","msg":"low memory"}'])
  })

  test("drop-mode F: flush at process exit while in drop-mode discards the leftover", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /"type":"x"/,
      cooldownMs: 0,
      batchMax: 1000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    // Build a partial overlong line and do NOT send a newline.
    const overlongPrefix = '{"type":"x","pad":"' + "y".repeat(WakeEngine.MAX_WAKE_LINE_BYTES)
    WakeEngine.feed(state, "stdout", Buffer.from(overlongPrefix, "utf8"))
    expect(state.dropping.stdout).toBe(true)

    // Process exits with the overlong line still unterminated. The engine
    // must not flush a fragment.
    WakeEngine.flush(state)
    await WakeEngine.flushDispatch(state)
    expect(fired).toEqual([])
    expect(state.dropping.stdout).toBe(false)
    expect(state.buffer.stdout).toBe("")
    expect(state.droppedLines).toBe(1)

    // A second flush must be a no-op.
    WakeEngine.flush(state)
    await WakeEngine.flushDispatch(state)
    expect(fired).toEqual([])
  })

  test("drop-mode G: boundary lengths and multi-byte characters", async () => {
    const fired: string[][] = []
    const makeState = () =>
      WakeEngine.createWake({
        pattern: /X/,
        cooldownMs: 0,
        batchMax: 1000,
        fire: async (input) => {
          fired.push([...input.lines])
        },
      })

    // G.1: line exactly at the cap is accepted.
    {
      const state = makeState()
      const line = "X".repeat(WakeEngine.MAX_WAKE_LINE_BYTES) + "\n"
      WakeEngine.feed(state, "stdout", Buffer.from(line, "utf8"))
      await asyncWait(() => state.fired === 1, "line at exactly MAX should fire")
      expect(fired[0][0].length).toBe(WakeEngine.MAX_WAKE_LINE_BYTES)
      expect(state.droppedLines).toBe(0)
    }

    // G.2: line one byte over the cap is dropped.
    {
      fired.length = 0
      const state = makeState()
      const line = "X".repeat(WakeEngine.MAX_WAKE_LINE_BYTES + 1) + "\n"
      WakeEngine.feed(state, "stdout", Buffer.from(line, "utf8"))
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(fired).toEqual([])
      expect(state.droppedLines).toBe(1)
    }

    // G.3: byte-based check, not character count. "修" is 3 bytes per char.
    // 21845 copies = 65535 bytes; + 1 ASCII "X" = 65536 bytes of line content,
    // which is exactly MAX and therefore allowed.
    {
      fired.length = 0
      const state = makeState()
      const content = "修".repeat(21845) + "X"
      expect(Buffer.byteLength(content, "utf8")).toBe(WakeEngine.MAX_WAKE_LINE_BYTES)
      WakeEngine.feed(state, "stdout", Buffer.from(content + "\n", "utf8"))
      await asyncWait(() => state.fired === 1, "multibyte line at MAX bytes should fire")
      expect(fired.length).toBe(1)
      expect(state.droppedLines).toBe(0)
    }

    // G.4: one more multi-byte char pushes us over the byte cap -> drop.
    {
      fired.length = 0
      const state = makeState()
      const line = "修".repeat(21846) + "\n"
      expect(Buffer.byteLength(line, "utf8")).toBeGreaterThan(WakeEngine.MAX_WAKE_LINE_BYTES)
      WakeEngine.feed(state, "stdout", Buffer.from(line, "utf8"))
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(fired).toEqual([])
      expect(state.droppedLines).toBe(1)
    }
  })

  test("drop-mode H: warning is logged once per overlong line, not per chunk", async () => {
    const fired: string[][] = []
    const warnings: string[] = []
    const state = WakeEngine.createWake({
      pattern: /"type":"x"/,
      cooldownMs: 0,
      batchMax: 1000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
      log: (level, message) => {
        if (level === "warn" && message.includes("exceeded max length")) warnings.push(message)
      },
    })

    // Build a single overlong line, delivered in 8 separate chunks. We must
    // not log 8 warnings.
    const overlong = '{"type":"x","pad":"' + "y".repeat(WakeEngine.MAX_WAKE_LINE_BYTES * 2) + '"}\n'
    const chunks: Buffer[] = []
    for (let offset = 0; offset < overlong.length; offset += 16 * 1024) {
      chunks.push(Buffer.from(overlong.slice(offset, offset + 16 * 1024), "utf8"))
    }
    expect(chunks.length).toBeGreaterThan(1)

    for (const chunk of chunks) {
      WakeEngine.feed(state, "stdout", chunk)
    }
    expect(state.droppedLines).toBe(1)
    expect(warnings.length).toBe(1)
    expect(fired).toEqual([])

    // A second overlong line increments the counter and logs again, but
    // each line is one warning regardless of how many chunks it took.
    const overlong2 = '{"type":"x","pad":"' + "y".repeat(WakeEngine.MAX_WAKE_LINE_BYTES * 2) + '"}\n'
    const chunks2: Buffer[] = []
    for (let offset = 0; offset < overlong2.length; offset += 12 * 1024) {
      chunks2.push(Buffer.from(overlong2.slice(offset, offset + 12 * 1024), "utf8"))
    }
    expect(chunks2.length).toBeGreaterThan(1)
    for (const chunk of chunks2) {
      WakeEngine.feed(state, "stdout", chunk)
    }
    expect(state.droppedLines).toBe(2)
    expect(warnings.length).toBe(2)
  })
})

describe("WakeEngine FIFO + cooldown", () => {
  test("K-T1: events within cooldown are queued and delivered in order once cooldown elapses", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /.+/,
      cooldownMs: 100,
      batchMax: 1000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    const events = ["generate", "steer", "accept", "exit"]
    for (const ev of events) WakeEngine.feed(state, "stdout", Buffer.from(`${ev}\n`, "utf8"))
    expect(state.queue).toEqual([...events])
    await asyncWait(() => fired.length > 0 && fired[0].length === 4, "events did not fire as a batch", 1000)
    expect(fired[0]).toEqual(events)
  })

  test("K-T2: fire failure re-queues events at the head and retries without dropping", async () => {
    const fired: string[][] = []
    let calls = 0
    const state = WakeEngine.createWake({
      pattern: /.+/,
      cooldownMs: 100,
      fire: async (input) => {
        calls++
        if (calls === 1) throw new Error("simulated transient failure")
        fired.push([...input.lines])
      },
    })

    WakeEngine.feed(state, "stdout", Buffer.from("a\nb\nc\n", "utf8"))
    await asyncWait(() => fired.flat().length === 3, "events were not retried", 1000)
    expect(fired.flat()).toEqual(["a", "b", "c"])
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  test("K-T3: concurrent dispatches are not started in parallel for the same state", async () => {
    const fired: string[][] = []
    let inFlight = 0
    let maxInFlight = 0
    const state = WakeEngine.createWake({
      pattern: /.+/,
      cooldownMs: 50,
      batchMax: 1,
      fire: async (input) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 30))
        fired.push([...input.lines])
        inFlight--
        return
      },
    })

    for (let index = 0; index < 5; index++) WakeEngine.feed(state, "stdout", Buffer.from(`e${index}\n`, "utf8"))
    await asyncWait(() => fired.flat().length === 5, `expected 5 fired, got ${fired.flat().length}`, 1500)
    expect(maxInFlight).toBe(1)
    expect(fired.flat()).toEqual(["e0", "e1", "e2", "e3", "e4"])
  })

  test("K-T4: queue overflow drops the oldest events and tracks the count", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /.+/,
      cooldownMs: 60_000, // huge cooldown so nothing fires during the test
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    const total = WakeEngine.MAX_WAKE_QUEUE + 10
    for (let index = 0; index < total; index++) WakeEngine.feed(state, "stdout", Buffer.from(`e${index}\n`, "utf8"))
    expect(state.dropped).toBe(10)
    expect(state.queue.length).toBe(WakeEngine.MAX_WAKE_QUEUE)
    expect(state.queue[0]).toBe("e10")
  })

  test("K-T5: batchMax caps the per-dispatch payload, leftover events survive", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /.+/,
      cooldownMs: 50,
      batchMax: 2,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    for (const id of ["a", "b", "c", "d", "e"])
      WakeEngine.feed(state, "stdout", Buffer.from(`${id}\n`, "utf8"))
    await asyncWait(() => fired.flat().length === 5, "all events should fire across batches", 1500)
    expect(fired[0]).toEqual(["a", "b"])
    expect(fired[1]).toEqual(["c", "d"])
    expect(fired[2]).toEqual(["e"])
  })

  test("K-T6: cooldown boundary does not lose events arriving just before it elapses", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /.+/,
      cooldownMs: 80,
      batchMax: 1000,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    WakeEngine.feed(state, "stdout", Buffer.from("first\n", "utf8"))
    await new Promise((resolve) => setTimeout(resolve, 60))
    WakeEngine.feed(state, "stdout", Buffer.from("second\n", "utf8"))
    await asyncWait(() => fired.flat().length === 2, "two events should fire eventually", 1000)
    expect(fired.flat()).toEqual(["first", "second"])
  })

  test("K-T7: byte cap evicts oldest events once the retained bytes would exceed the budget", async () => {
    const fired: string[][] = []
    const warnings: string[] = []
    const state = WakeEngine.createWake({
      pattern: /.+/,
      cooldownMs: 60_000, // huge cooldown so nothing fires during the test
      fire: async (input) => {
        fired.push([...input.lines])
      },
      log: (level, message) => {
        if (level === "warn") warnings.push(message)
      },
    })

    // Each line stays well under MAX_WAKE_LINE_BYTES so the line-size policy
    // never applies. Use 16 KiB lines so the byte cap kicks in well before
    // the line-count cap and is the only mechanism that drops anything.
    const lineSize = 16 * 1024 // 16 KiB per line
    const line = "x".repeat(lineSize)
    const total = 1_500
    for (let index = 0; index < total; index++)
      WakeEngine.feed(state, "stdout", Buffer.from(`${line}-${index}\n`, "utf8"))

    expect(state.queueBytes).toBeLessThanOrEqual(WakeEngine.MAX_WAKE_QUEUE_BYTES + lineSize)
    expect(state.droppedBytes).toBeGreaterThan(0)
    expect(state.dropped).toBe(0)
    expect(state.queue.length).toBeLessThanOrEqual(WakeEngine.MAX_WAKE_QUEUE)
    expect(warnings.some((message) => message.includes("byte cap"))).toBe(true)
  })

  test("K-T8: dispatch deducts the batched bytes from queueBytes so the cap recovers", async () => {
    const fired: string[][] = []
    const state = WakeEngine.createWake({
      pattern: /.+/,
      cooldownMs: 10,
      batchMax: 2,
      fire: async (input) => {
        fired.push([...input.lines])
      },
    })

    WakeEngine.feed(state, "stdout", Buffer.from("alpha\nbeta\ngamma\n", "utf8"))
    const beforeBytes = state.queueBytes
    expect(beforeBytes).toBeGreaterThan(0)
    await asyncWait(() => fired.flat().length === 3, "all events should fire", 1000)
    expect(state.queueBytes).toBe(0)
    expect(fired.flat()).toEqual(["alpha", "beta", "gamma"])
  })
})

describe("BackgroundProcess integration", () => {
  beforeEach(() => {
    BackgroundProcess._setWakeFireForTest()
  })
  afterEach(() => {
    BackgroundProcess._setWakeFireForTest()
  })

  test("ordinary background process without wake.pattern records output unchanged", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.descending()
        const command = await script(
          tmp.path,
          "plain.mjs",
          `console.log("ready")
setTimeout(() => console.log("after"), 100)
setInterval(() => {}, 1000)
`,
        )
        const wakeFireSpy: { called: number } = { called: 0 }
        BackgroundProcess._setWakeFireForTest(async () => {
          wakeFireSpy.called++
        })
        try {
          const info = await BackgroundProcess.start({
            sessionID,
            command,
            cwd: tmp.path,
            ready: { pattern: "ready", timeout: 5_000 },
          })
          await BackgroundProcess.stop(info.id)
          await Bun.sleep(50)
          expect(wakeFireSpy.called).toBe(0)
        } finally {
          await BackgroundProcess.stopSession(sessionID)
        }
      },
    })
  }, 10_000)

  test(
    "live child process streams JSON events and fires each event exactly once in order",
    async () => {
      await using tmp = await tmpdir()
      await provideTestInstance({
        directory: tmp.path,
        fn: async () => {
          const sessionID = SessionID.descending()
          // Emit five events with deliberate delays so chunks split at the
          // 64KiB pipe buffer boundary. Each payload stays under the per-line
          // buffer cap so it is delivered intact.
          const pad = (count: number) => "x".repeat(count)
          const command = await script(
            tmp.path,
            "events.mjs",
            `const writes = [
  '{"type":"generate","id":"e1"}',
  '{"type":"steer","id":"e2","message":"' + ${JSON.stringify(pad(32 * 1024))} + '"}',
  '{"type":"accept","id":"e3"}',
  '{"type":"steer","id":"e4","message":"\\u4fee\\u6539\\u9875\\u9762\\u5e03\\u5c40"}',
  '{"type":"exit","token":"abc"}',
]
let index = 0
const tick = () => {
  if (index >= writes.length) return process.exit(0)
  process.stdout.write(writes[index++] + "\\n", tick)
}
tick()
`,
          )

          const fired: string[][] = []
          BackgroundProcess._setWakeFireForTest(async (payload) => {
            fired.push([...payload.lines])
          })

          let info
          try {
            info = await BackgroundProcess.start({
              sessionID,
              command,
              cwd: tmp.path,
              wake: { pattern: '"type":"(generate|steer|accept|exit)"' },
            })
            // Wait until the process exits OR a 6s safety timeout.
            const end = Date.now() + 6_000
            while (Date.now() < end) {
              const current = await BackgroundProcess.get(info.id)
              if (!current || current.status === "exited" || current.status === "failed") break
              await Bun.sleep(50)
            }
          } finally {
            if (info) await BackgroundProcess.stop(info.id)
          }
          // Allow the final wake dispatch (flush on exit) to settle.
          await Bun.sleep(500)
          await BackgroundProcess.stopSession(sessionID)

          const flat = fired.flat()
          if (flat.length !== 5) {
            // Dump for debugging if the test fails.
            console.error("wake fires observed:", JSON.stringify(fired, null, 2))
          }
          expect(flat.length).toBe(5)
          const seen = new Set<string>()
          for (const line of flat) seen.add(line)
          expect(seen.size).toBe(5)
          expect(flat[0]).toContain('"id":"e1"')
          expect(flat[1]).toContain('"id":"e2"')
          expect(flat[2]).toContain('"id":"e3"')
          expect(flat[3]).toContain('"id":"e4"')
          expect(flat[4]).toContain('"type":"exit"')
          expect(flat[4]).toContain('"token":"abc"')
          expect(flat[3]).toContain("\u4fee\u6539\u9875\u9762\u5e03\u5c40")
          expect(flat.some((line) => line.includes("\ufffd"))).toBe(false)
        },
      })
    },
    20_000,
  )

  test(
    "process exit with no trailing newline flushes the final event (no event lost, no duplicate)",
    async () => {
      await using tmp = await tmpdir()
      await provideTestInstance({
        directory: tmp.path,
        fn: async () => {
          const sessionID = SessionID.descending()
          const command = await script(
            tmp.path,
            "exitbare.mjs",
            `process.stdout.write('{"type":"exit","token":"final"}')
setTimeout(() => process.exit(0), 50)
`,
          )

          const fired: string[][] = []
          BackgroundProcess._setWakeFireForTest(async (payload) => {
            fired.push([...payload.lines])
          })

          let info
          try {
            info = await BackgroundProcess.start({
              sessionID,
              command,
              cwd: tmp.path,
              wake: { pattern: '"type":"exit"' },
            })
            const end = Date.now() + 5_000
            while (Date.now() < end) {
              const current = await BackgroundProcess.get(info.id)
              if (!current || current.status === "exited" || current.status === "failed") break
              await Bun.sleep(50)
            }
          } finally {
            if (info) await BackgroundProcess.stop(info.id)
          }
          await Bun.sleep(500)
          await BackgroundProcess.stopSession(sessionID)

          const exitFires = fired.flat().filter((line) => line.includes('"type":"exit"'))
          expect(exitFires.length).toBe(1)
          expect(exitFires[0]).toContain('"token":"final"')
        },
      })
    },
    15_000,
  )
})
