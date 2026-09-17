import { expect, test } from "bun:test"
import type { Event } from "@kilocode/sdk/v2"
import { createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { KiloTerminalActivity as Activity } from "../../src/kilocode/cli/cmd/tui/terminal-activity"

function data(input: Partial<Activity.Data> = {}): Activity.Data {
  return {
    session: [
      { id: "parent", title: "Session" },
      { id: "child", title: "Child", parentID: "parent" },
    ],
    session_status: {},
    permission: {},
    question: {},
    suggestion: {},
    network: {},
    message: {},
    part: {},
    ...input,
  }
}

const classify = (input: Partial<Activity.Data>, outcome?: "completed" | "error" | "interrupted" | "superseded") =>
  Activity.classify({ id: "parent", data: data(input), outcomes: { parent: outcome } })

test("classifies active children, attention and completed outcomes", () => {
  expect(Activity.classify({ data: data({ session_status: { parent: { type: "busy" } } }) })).toBe("idle")
  for (const type of ["idle", "busy", "retry"] as const) {
    expect(classify({ session: [], session_status: { parent: { type } } })).toBe(type)
    expect(classify({ session_status: { child: { type } } })).toBe(type)
  }
  for (const key of ["permission", "question", "suggestion", "network"] as const) {
    expect(classify({ [key]: { child: [{}] }, session_status: { parent: { type: "busy" } } }, "completed")).toBe(
      "waiting",
    )
  }
  expect(classify({ session_status: { child: { type: "offline" } } })).toBe("waiting")
  for (const [outcome, expected] of [
    [undefined, "idle"],
    ["completed", "done"],
    ["error", "error"],
    ["interrupted", "idle"],
    ["superseded", "idle"],
  ] as const) {
    expect(classify({}, outcome)).toBe(expected)
  }
  for (const finish of ["error", "content-filter", "length", "unknown", "other", "tool-calls"]) {
    expect(classify({ message: { parent: [{ id: "reply", role: "assistant", finish }] } }, "completed")).toBe(
      ["error", "content-filter"].includes(finish) ? "error" : "idle",
    )
  }
  for (const name of ["APIError", "MessageAbortedError"]) {
    expect(classify({ message: { parent: [{ id: "reply", role: "assistant", error: { name } }] } }, "completed")).toBe(
      name === "APIError" ? "error" : "idle",
    )
  }
})

test("opt-in emitter sends transitions, heartbeat and cleanup independently of titles", async () => {
  const [session, select] = createSignal<string | undefined>("parent")
  const [store, set] = createStore(data())
  const output: string[] = []
  let emit!: (event: Event) => void
  let subscribed = false
  const heartbeat = Promise.withResolvers<void>()
  const dispose = createRoot((dispose) => {
    const opts = {
      session,
      data: store,
      subscribe: (handler: (event: Event) => void) => {
        emit = handler
        subscribed = true
        return () => {
          subscribed = false
        }
      },
      write: (value: string) => {
        const state = value.split(";").at(4)!
        if (state === "done" && output.at(-1) === "done") heartbeat.resolve()
        output.push(state)
        expect(value).toMatch(/^\x1b\]777;kilo;activity;1;\w+;\d+\x07$/)
      },
    }
    for (const enabled of [undefined, "", "0", "true"]) Activity.use({ ...opts, enabled })
    expect(subscribed).toBe(false)
    expect(output).toEqual([])
    Activity.use({ ...opts, enabled: "1" })
    return dispose
  })
  try {
    set("session", 0, "title", "Renamed")
    expect(output).toEqual(["idle"])
    set("session_status", "parent", { type: "busy" })
    set("question", "child", [{}])
    set("question", "child", [])
    set("session_status", "parent", { type: "retry" })
    set("session_status", "parent", { type: "idle" })
    emit({ id: "failed", type: "session.error", properties: { sessionID: "parent" } })
    emit({ id: "closed", type: "session.turn.close", properties: { sessionID: "parent", reason: "completed" } })
    expect(output.at(-1)).toBe("error")
    emit({ id: "opened", type: "session.turn.open", properties: { sessionID: "parent" } })
    emit({ id: "completed", type: "session.turn.close", properties: { sessionID: "parent", reason: "completed" } })
    expect(output).toEqual(["idle", "busy", "waiting", "busy", "retry", "idle", "error", "idle", "done"])
    await heartbeat.promise
    select(undefined)
    expect(output.slice(-3)).toEqual(["done", "done", "idle"])
  } finally {
    dispose()
  }
  expect(subscribed).toBe(false)
  const count = output.length
  select("parent")
  set("session_status", "parent", { type: "busy" })
  await Bun.sleep(5_100)
  expect(output).toHaveLength(count)
}, 15_000)
