// kilocode_change - new file
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Log } from "../../src/util/log"
import { State } from "../../src/project/state"

Log.init({ print: false })

const clock = { now: 0 }
const tasks = new Map<number, { at: number; fn: () => void }>()
let next = 1

const realSetTimeout = globalThis.setTimeout

function schedule(fn: () => void, ms = 0) {
  const id = next
  next += 1
  const timer = {
    unref() {
      return timer
    },
  }
  tasks.set(id, { at: clock.now + ms, fn })
  return timer as unknown as ReturnType<typeof globalThis.setTimeout>
}

function flush() {
  while (true) {
    const due = Array.from(tasks.entries())
      .filter(([, task]) => task.at <= clock.now)
      .sort((a, b) => a[1].at - b[1].at)
    if (due.length === 0) return
    for (const [id, task] of due) {
      tasks.delete(id)
      task.fn()
    }
  }
}

describe("State.dispose", () => {
  beforeEach(() => {
    clock.now = 0
    tasks.clear()
    next = 1
    globalThis.setTimeout = schedule as typeof globalThis.setTimeout
  })

  afterEach(() => {
    globalThis.setTimeout = realSetTimeout
  })

  test("continues after a disposer times out", async () => {
    const calls: string[] = []
    const root = () => "test-key"
    const hung = State.create(
      root,
      () => "hung",
      async () => {
        calls.push("hung:start")
        await new Promise(() => {})
      },
    )
    const fast = State.create(
      root,
      () => "fast",
      async () => {
        calls.push("fast")
      },
    )

    hung()
    fast()

    const dispose = State.dispose("test-key")
    await Promise.resolve()
    expect(calls).toEqual(["hung:start", "fast"])

    clock.now = 15_000
    flush()
    await dispose

    const again = State.create(root, () => "again")
    expect(again()).toBe("again")
  })
})
