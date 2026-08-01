import { MemoryAudit } from "../src/storage/audit"
import { MemoryLog } from "../src/effect/log"

describe("memory audit → debug log", () => {
  let captured: { message: string; meta?: Record<string, unknown> }[] = []

  beforeEach(() => {
    captured = []
    MemoryLog.setDebug((message, meta) => captured.push({ message, meta }))
  })

  afterEach(() => {
    MemoryLog.setDebug(() => {})
  })

  test("debug() is a no-op until a logger is injected", () => {
    MemoryLog.setDebug(() => {})
    expect(() => MemoryLog.debug("anything")).not.toThrow()
  })

  test("append() routes a log record through the debug channel", async () => {
    await MemoryAudit.append("/tmp/root", "hello world")
    expect(captured).toEqual([
      { message: "memory audit", meta: { kind: "log", result: "logged", summary: "hello world" } },
    ])
  })

  test("decide() routes a structured decision through the debug channel", async () => {
    await MemoryAudit.decide("/tmp/root", { kind: "digest", result: "saved", operationCount: 3 })
    expect(captured).toHaveLength(1)
    expect(captured[0].message).toBe("memory audit")
    expect(captured[0].meta).toMatchObject({ kind: "digest", result: "saved", operationCount: 3 })
  })

  test("warn and debug use independent channels", () => {
    const warns: string[] = []
    MemoryLog.setWarn((message) => warns.push(message))
    MemoryLog.warn("w1")
    MemoryLog.debug("d1")
    expect(warns).toEqual(["w1"])
    expect(captured.map((item) => item.message)).toEqual(["d1"])
  })
})
