import { describe, expect, it } from "bun:test"
import path from "node:path"
import { hasActiveOverlap, rewindCheckpoint } from "../../src/kilo-provider/checkpoint-rewind"

const flow = (input?: { overlap?: boolean; confirm?: boolean; abort?: Error; revert?: Error }) => {
  const calls: string[] = []
  return {
    calls,
    run: () =>
      rewindCheckpoint({
        sessionID: "session",
        overlap: input?.overlap ?? false,
        confirm: async () => {
          calls.push("confirm")
          return input?.confirm ?? true
        },
        abort: async () => {
          calls.push("abort")
          if (input?.abort) throw input.abort
        },
        revert: async () => {
          calls.push("revert")
          if (input?.revert) throw input.revert
        },
      }),
  }
}

describe("rewindCheckpoint", () => {
  it("aborts before reverting even when the session may already be idle", async () => {
    const state = flow()

    expect(await state.run()).toBe(true)
    expect(state.calls).toEqual(["abort", "revert"])
  })

  it("does not revert when abort fails", async () => {
    const state = flow({ abort: new Error("abort failed") })

    await expect(state.run()).rejects.toThrow("abort failed")
    expect(state.calls).toEqual(["abort"])
  })

  it("does not report success when revert fails", async () => {
    const state = flow({ revert: new Error("revert failed") })

    await expect(state.run()).rejects.toThrow("revert failed")
    expect(state.calls).toEqual(["abort", "revert"])
  })

  it("cancels before mutation when another active session shares the directory", async () => {
    const state = flow({ overlap: true, confirm: false })

    expect(await state.run()).toBe(false)
    expect(state.calls).toEqual(["confirm"])
  })

  it("continues in order after shared-directory confirmation", async () => {
    const state = flow({ overlap: true, confirm: true })

    expect(await state.run()).toBe(true)
    expect(state.calls).toEqual(["confirm", "abort", "revert"])
  })

  it("rejects a duplicate rewind while the first request is active", async () => {
    let release = () => {}
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const calls: string[] = []
    const first = rewindCheckpoint({
      sessionID: "duplicate",
      overlap: false,
      confirm: async () => true,
      abort: async () => {
        calls.push("abort")
        await blocked
      },
      revert: async () => {
        calls.push("revert")
      },
    })
    await Promise.resolve()
    const second = await rewindCheckpoint({
      sessionID: "duplicate",
      overlap: false,
      confirm: async () => true,
      abort: async () => {
        calls.push("duplicate-abort")
      },
      revert: async () => {
        calls.push("duplicate-revert")
      },
    })

    expect(second).toBe(false)
    release()
    expect(await first).toBe(true)
    expect(calls).toEqual(["abort", "revert"])
  })
})

describe("hasActiveOverlap", () => {
  it("detects another active session in the same normalized directory", async () => {
    const dir = path.resolve("/tmp/project")
    const overlap = await hasActiveOverlap({
      sessionID: "a",
      directory: dir,
      statuses: new Map([
        ["a", "busy"],
        ["b", "retry"],
      ]),
      directoryFor: () => path.join(dir, "."),
    })

    expect(overlap).toBe(true)
  })

  it("ignores idle sessions and sessions in another worktree", async () => {
    const statuses = new Map([
      ["idle", "idle"],
      ["worktree", "busy"],
    ])
    const overlap = await hasActiveOverlap({
      sessionID: "a",
      directory: "/tmp/project",
      statuses,
      directoryFor: (id) => (id === "idle" ? "/tmp/project" : "/tmp/project-worktree"),
    })

    expect(overlap).toBe(false)
  })
})
