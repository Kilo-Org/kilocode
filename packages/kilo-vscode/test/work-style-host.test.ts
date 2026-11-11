import { expect, test } from "bun:test"
import { workStyleHost } from "../src/work-style-host"

test("a failed session probe answers skipped without persisting a state", async () => {
  const messages: unknown[] = []
  const host = workStyleHost({
    context: {} as never,
    server: {
      get: async () => ({ url: "http://127.0.0.1:1", authorization: "test" }),
    } as never,
    directory: "/tmp",
    post: (message) => messages.push(message),
  })

  await host.handle({ type: "requestWorkStyle" })

  expect(messages).toContainEqual({ type: "workStyleLoaded", style: "skipped" })
})
