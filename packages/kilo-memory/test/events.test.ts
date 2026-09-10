import { afterEach, expect, test } from "bun:test"
import { MemoryEvents } from "../src/effect/events"

const disposers: Array<() => void> = []

afterEach(() => {
  while (disposers.length) disposers.pop()?.()
  MemoryEvents.setSink(() => {})
})

function payload(detail?: "saved" | "skipped"): MemoryEvents.Status {
  return {
    directory: "/tmp/memory-events-test",
    enabled: true,
    state: "idle",
    project: { bytes: 1, estimatedTokens: 1, truncated: false },
    ...(detail ? { detail: { type: detail, message: "Memory saved · project.md" } } : {}),
  }
}

test("subscribe delivers published events until disposed", async () => {
  const seen: string[] = []
  disposers.push(
    MemoryEvents.subscribe((input) => {
      seen.push(`${input.event ?? "none"}:${input.payload.state}`)
    }),
  )
  await MemoryEvents.publish({ event: "status", payload: payload() })
  expect(seen).toEqual(["status:idle"])
  disposers.pop()?.()
  await MemoryEvents.publish({ event: "status", payload: payload() })
  expect(seen).toEqual(["status:idle"])
})

test("subscribers are additive with the legacy sink and never overwrite it", async () => {
  const sinkSeen: string[] = []
  const firstSeen: string[] = []
  const secondSeen: string[] = []
  MemoryEvents.setSink((input) => {
    sinkSeen.push(input.payload.directory)
  })
  disposers.push(
    MemoryEvents.subscribe((input) => {
      firstSeen.push(input.payload.directory)
    }),
    MemoryEvents.subscribe((input) => {
      secondSeen.push(input.payload.directory)
    }),
  )
  await MemoryEvents.publish({ event: "updated", payload: payload("saved") })
  expect(sinkSeen).toEqual(["/tmp/memory-events-test"])
  expect(firstSeen).toEqual(["/tmp/memory-events-test"])
  expect(secondSeen).toEqual(["/tmp/memory-events-test"])
})

test("a failing sink or listener does not break other deliveries or the publish", async () => {
  const seen: string[] = []
  MemoryEvents.setSink(() => {
    throw new Error("sink failure")
  })
  disposers.push(
    MemoryEvents.subscribe(() => {
      throw new Error("listener failure")
    }),
    MemoryEvents.subscribe((input) => {
      seen.push(input.payload.state)
    }),
  )
  await MemoryEvents.publish({ event: "status", payload: payload() })
  expect(seen).toEqual(["idle"])
})

test("a failing async listener is contained per listener", async () => {
  const seen: string[] = []
  disposers.push(
    MemoryEvents.subscribe(async () => {
      throw new Error("async listener failure")
    }),
    MemoryEvents.subscribe((input) => {
      seen.push(input.payload.state)
    }),
  )
  await MemoryEvents.publish({ event: "status", payload: payload() })
  expect(seen).toEqual(["idle"])
})

test("disposing one listener keeps the rest subscribed", async () => {
  const kept: string[] = []
  const dropped: string[] = []
  const drop = MemoryEvents.subscribe(() => {
    dropped.push("x")
  })
  disposers.push(
    MemoryEvents.subscribe(() => {
      kept.push("x")
    }),
  )
  drop()
  await MemoryEvents.publish({ event: "status", payload: payload() })
  expect(kept).toEqual(["x"])
  expect(dropped).toEqual([])
})
