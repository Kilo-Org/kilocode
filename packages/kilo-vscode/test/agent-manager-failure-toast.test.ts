import { describe, expect, test } from "bun:test"
import { reportFailure } from "../webview-ui/agent-manager/failure-toast"

function run(message: unknown) {
  const toasts: string[] = []
  reportFailure(message as never, {
    toast: (value) => toasts.push(value.description),
    t: (key) => key,
    project: "project",
  })
  return toasts
}

describe("Agent Manager failure toast", () => {
  test("shows a host action failure", () => {
    expect(run({ type: "error", message: "Could not create the worktree" })).toEqual(["Could not create the worktree"])
  })

  test("ignores a request error, which carries its request id", () => {
    expect(run({ type: "error", id: 7, message: "aborted" })).toEqual([])
  })
})