import { afterAll, expect, test } from "bun:test"

// The highlighting worker runs in its own thread in a browser and is never constructed in the VS Code webview, so the
// component tests cannot reach it. This loads the worker entry itself and answers one request, which is the only way
// a missing or mistyped import in that bundle fails a test instead of silently degrading to the main thread.

const scope = globalThis as unknown as {
  onmessage?: (event: { data: unknown }) => void
  postMessage?: (data: unknown) => void
}
const previous = { onmessage: scope.onmessage, postMessage: scope.postMessage }
const messages: Array<Record<string, unknown>> = []

afterAll(() => {
  scope.onmessage = previous.onmessage
  scope.postMessage = previous.postMessage
})

async function answer(request: Record<string, unknown>, timeout = 20000) {
  scope.onmessage?.({ data: request })
  const started = Date.now()
  for (;;) {
    const reply = messages.find((message) => message.id === request.id)
    if (reply) return reply
    if (Date.now() - started > timeout) throw new Error(`The worker did not answer request ${request.id}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

test("the worker entry answers a completed block with tokens", async () => {
  const { KiloTheme } = await import("../../kilo-ui-base/src/context/marked")
  await import("../../kilo-ui-base/src/components/markdown-shiki.worker.ts")
  scope.postMessage = (data) => messages.push(data as Record<string, unknown>)

  // init has no reply; it only creates the highlighter and registers the theme.
  scope.onmessage?.({ data: { type: "init", theme: KiloTheme } })
  const reply = await answer({ type: "highlight", id: 1, key: "block", text: "const a = 1\nconst b = 2", language: "ts", complete: true })

  expect(reply.type).toBe("highlight")
  const stable = reply.stable as Array<[string, string]>
  expect(stable.map((token) => token[0]).join("")).toBe("const a = 1\nconst b = 2")
  expect(stable.some((token) => token[1])).toBe(true)
}, 30000)
