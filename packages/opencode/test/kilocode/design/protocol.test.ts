import { describe, expect, test } from "bun:test"
import { createJsonlParser, encodeCommand, normalize, parseLine } from "../../../src/kilocode/design/voice/protocol"

describe("voice protocol normalize", () => {
  test("accepts known states", () => {
    expect(normalize({ type: "state", value: "listening" })).toEqual({ type: "state", value: "listening" })
  })

  test("rejects unknown state values", () => {
    expect(normalize({ type: "state", value: "asleep" })).toBeUndefined()
  })

  test("trims and keeps turn text, dropping empty turns", () => {
    expect(normalize({ type: "turn", text: "  make it blue  " })).toEqual({ type: "turn", text: "make it blue" })
    expect(normalize({ type: "turn", text: "   " })).toBeUndefined()
  })

  test("carries turnId and latency when present", () => {
    expect(normalize({ type: "turn", text: "go", turnId: "t1", latencyMs: 42 })).toEqual({
      type: "turn",
      text: "go",
      turnId: "t1",
      latencyMs: 42,
    })
  })

  test("clamps level into 0..1", () => {
    expect(normalize({ type: "level", peak: 2 })).toEqual({ type: "level", peak: 1 })
    expect(normalize({ type: "level", peak: -5 })).toEqual({ type: "level", peak: 0 })
  })

  test("ignores junk", () => {
    expect(normalize(null)).toBeUndefined()
    expect(normalize({ type: "nope" })).toBeUndefined()
    expect(normalize(42)).toBeUndefined()
  })
})

describe("parseLine", () => {
  test("returns undefined for blank or malformed lines", () => {
    expect(parseLine("")).toBeUndefined()
    expect(parseLine("   ")).toBeUndefined()
    expect(parseLine("{not json")).toBeUndefined()
  })

  test("parses a valid frame", () => {
    expect(parseLine('{"type":"partial","text":"make"}')).toEqual({ type: "partial", text: "make" })
  })
})

describe("streaming JSONL parser", () => {
  test("emits complete frames and buffers partial lines across chunks", () => {
    const parser = createJsonlParser()
    const first = parser.write('{"type":"state","value":"listening"}\n{"type":"par')
    expect(first).toEqual([{ type: "state", value: "listening" }])

    const second = parser.write('tial","text":"hello"}\n')
    expect(second).toEqual([{ type: "partial", text: "hello" }])
  })

  test("drops malformed frames but recovers on the next valid one", () => {
    const parser = createJsonlParser()
    const events = parser.write('garbage line\n{"type":"turn","text":"go"}\n')
    expect(events).toEqual([{ type: "turn", text: "go" }])
  })

  test("flush parses a trailing newline-less line", () => {
    const parser = createJsonlParser()
    expect(parser.write('{"type":"turn","text":"a"}')).toEqual([])
    expect(parser.flush()).toEqual([{ type: "turn", text: "a" }])
  })
})

describe("encodeCommand", () => {
  test("produces newline-terminated JSON", () => {
    expect(encodeCommand({ type: "reset" })).toBe('{"type":"reset"}\n')
  })
})
