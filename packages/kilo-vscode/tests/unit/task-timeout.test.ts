import { expect, it } from "bun:test"
import { watchTask, type TaskEnd } from "../../src/agent-manager/task-timeout"

function harness(terminate: () => unknown = () => {}) {
  const process: Array<(event: TaskEnd) => void> = []
  const end: Array<(event: TaskEnd) => void> = []
  const execution = { terminate }
  return {
    execution,
    handlers: {
      onProcess: (cb: (event: TaskEnd) => void) => {
        process.push(cb)
        return { dispose: () => {} }
      },
      onEnd: (cb: (event: TaskEnd) => void) => {
        end.push(cb)
        return { dispose: () => {} }
      },
    },
    fireEnd: () => end.forEach((cb) => cb({ execution })),
    fireProcess: (exitCode: number) => process.forEach((cb) => cb({ execution, exitCode })),
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

it("waits for the stop event before rejecting an install timeout", async () => {
  const fake = harness()
  let settled: Error | number | undefined
  const task = watchTask({
    execution: fake.execution,
    handlers: fake.handlers,
    budget: 10,
    message: "Task timed out after 1 minutes",
    stop: true,
    grace: 50,
    fallback: 500,
  })
  void task.then(
    (code) => {
      settled = code
    },
    (error: Error) => {
      settled = error
    },
  )
  await wait(40)
  expect(settled).toBeUndefined()
  fake.fireEnd()
  await wait(0)
  expect(settled).toBeInstanceOf(Error)
  expect((settled as Error).message).toBe("Task timed out after 1 minutes")
})

it("rejects from the fallback when the stop event never arrives", async () => {
  const fake = harness()
  const error = await watchTask({
    execution: fake.execution,
    handlers: fake.handlers,
    budget: 10,
    message: "Task timed out",
    stop: true,
    grace: 50,
    fallback: 40,
  }).catch((err: Error) => err)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toBe("Task timed out")
})

it("rejects a setup timeout without waiting for termination", async () => {
  const fake = harness()
  const error = await watchTask({
    execution: fake.execution,
    handlers: fake.handlers,
    budget: 10,
    message: "Setup script timed out after 5 minutes",
    stop: false,
    grace: 50,
  }).catch((err: Error) => err)
  expect((error as Error).message).toBe("Setup script timed out after 5 minutes")
})

it("does not leave an unhandled rejection when terminate rejects", async () => {
  const fake = harness(() => Promise.reject(new Error("terminate failed")))
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => unhandled.push(reason)
  process.on("unhandledRejection", onUnhandled)
  try {
    const error = await watchTask({
      execution: fake.execution,
      handlers: fake.handlers,
      budget: 5,
      message: "Task timed out",
      stop: true,
      grace: 50,
      fallback: 30,
    }).catch((err: Error) => err)
    expect((error as Error).message).toBe("Task timed out")
    await wait(20)
    expect(unhandled).toEqual([])
  } finally {
    process.off("unhandledRejection", onUnhandled)
  }
})
