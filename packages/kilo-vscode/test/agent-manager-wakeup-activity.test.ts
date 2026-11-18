import { describe, expect, mock, test } from "bun:test"
import type { Data } from "@opencode/client/solid"

const CLIENT_SOLID = "solid-js/dist/solid.js"
mock.module("solid-js", () => import(CLIENT_SOLID))

const { sessionActivity } = await import("../webview-ui/agent-manager/v2/activity")

function data(input: {
  status?: "running"
  family?: string[]
  outcome?: "succeeded" | "failed"
  idle?: number
  viewed?: number
}) {
  return {
    session: {
      family: () => input.family ?? [],
      permission: { list: () => [] },
      form: { list: () => [] },
      status: () => input.status,
      message: { list: () => [] },
      get: () =>
        input.outcome === undefined
          ? undefined
          : { outcome: input.outcome, time: { created: 1, updated: 1, idle: input.idle, viewed: input.viewed } },
    },
  } as unknown as Data
}

describe("sessionActivity with a pending wakeup", () => {
  test("shows an idle session as scheduled", () => {
    expect(sessionActivity(data({}), "ses_a", true, true)).toBe("scheduled")
  })

  test("keeps a running session busy", () => {
    expect(sessionActivity(data({ status: "running" }), "ses_a", true, true)).toBe("busy")
  })

  test("keeps an unseen completion as done", () => {
    expect(sessionActivity(data({ outcome: "succeeded", idle: 5, viewed: 1 }), "ses_a", true, true)).toBe("done")
  })

  test("keeps a failed outcome as error", () => {
    expect(sessionActivity(data({ outcome: "failed" }), "ses_a", true, true)).toBe("error")
  })

  test("lifts a running subagent over the wakeup", () => {
    expect(sessionActivity(data({ family: ["ses_child"], status: "running" }), "ses_a", true, true)).toBe("busy")
  })

  test("stays idle without a wakeup", () => {
    expect(sessionActivity(data({}), "ses_a", true, false)).toBe("idle")
  })
})
