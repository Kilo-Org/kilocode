import { afterEach, describe, expect, it, mock } from "bun:test"
import { stopSessionProcesses } from "../../src/kilo-provider/background-process"

const warn = console.warn

afterEach(() => {
  console.warn = warn
})

describe("stopSessionProcesses", () => {
  it("stops all background processes for a session in the provided directory", async () => {
    const calls: unknown[] = []
    const client = {
      backgroundProcess: {
        stopSession: mock(async (params: unknown) => {
          calls.push(params)
          return { data: {} }
        }),
      },
    }

    await stopSessionProcesses(client as never, "s1", "/repo/worktree")

    expect(calls).toEqual([{ sessionID: "s1", directory: "/repo/worktree" }])
  })

  it("logs stop failures without throwing", async () => {
    const warnings: unknown[][] = []
    console.warn = (...args: unknown[]) => {
      warnings.push(args)
    }
    const err = new Error("stop failed")
    const client = {
      backgroundProcess: {
        stopSession: mock(async () => {
          throw err
        }),
      },
    }

    await stopSessionProcesses(client as never, "s1", "/repo")

    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.[1]).toBe(err)
  })
})
