import { describe, expect, it } from "bun:test"
import { routeChatInput } from "../../webview-ui/src/utils/chat-input-route"

function run(message: { type?: string }, view: string) {
  const calls: string[] = []
  const posted: { type?: string }[] = []
  routeChatInput(
    message,
    view,
    () => calls.push("show"),
    (msg) => {
      calls.push("post")
      posted.push(msg)
    },
  )
  return { calls, posted }
}

describe("routeChatInput", () => {
  it("switches to the chat and re-posts editor actions from History", () => {
    for (const type of ["triggerTask", "appendChatContext"]) {
      const message = { type }
      const { calls, posted } = run(message, "history")
      expect(calls).toEqual(["show", "post"])
      expect(posted).toEqual([message])
    }
  })

  it("leaves editor actions to the prompt box when the chat is showing", () => {
    expect(run({ type: "triggerTask" }, "newTask").calls).toEqual([])
    expect(run({ type: "appendChatContext" }, "newTask").calls).toEqual([])
  })

  it("ignores other messages on History", () => {
    expect(run({ type: "openSession" }, "history").calls).toEqual([])
    expect(run({}, "history").calls).toEqual([])
  })

  it("re-posts the selection payload unchanged", () => {
    const message = {
      type: "appendChatContext",
      context: { id: "ctx-1", filePath: "src/app.ts", startLine: 3, endLine: 7, text: "const a = 1" },
    }
    const { posted } = run(message, "history")
    expect(posted[0]).toBe(message)
  })

  it("delivers the re-posted message once, without posting it again", () => {
    let view = "history"
    const queue: { type?: string }[] = []
    const route = (message: { type?: string }) =>
      routeChatInput(
        message,
        view,
        () => (view = "newTask"),
        (msg) => queue.push(msg),
      )

    route({ type: "triggerTask", text: "Explain" } as { type: string })
    expect(view).toBe("newTask")
    expect(queue).toHaveLength(1)

    // The re-posted copy reaches App's handler again on the next tick.
    route(queue.shift()!)
    expect(queue).toHaveLength(0)
  })
})
