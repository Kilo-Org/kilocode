import { expect, test } from "bun:test"
import path from "node:path"
import { Project } from "ts-morph"
import type { AutoCleanupStateLoadedMessage } from "../../webview-ui/src/types/messages"

// Exercise the actual handler without loading unrelated VS Code provider dependencies.
const source = new Project().addSourceFileAtPath(path.join(import.meta.dir, "../../src/KiloProvider.ts"))
const method = source.getClassOrThrow("KiloProvider").getMethodOrThrow("handleAutoCleanupMessage").getText()
const code = new Bun.Transpiler({ loader: "ts" }).transformSync(`class Provider { ${method} }`)
const handler = new Function(`${code}; return Provider.prototype.handleAutoCleanupMessage`)()

test.each([
  { requested: false, available: false, error: "run" },
  { requested: true, available: false, error: undefined },
  { requested: false, available: true, error: undefined },
  { requested: true, available: true, error: undefined },
])("stop result $requested with status available $available", async ({ requested, available, error }) => {
  const replies: AutoCleanupStateLoadedMessage[] = []
  const service = {
    cancel: async () => requested,
    status: async () => {
      if (!available) throw new Error("Status unavailable")
      return { last: null }
    },
    lastResult: () => null,
    running: false,
  }
  expect(
    await handler.call(
      { autoCleanup: () => service, postMessage: (message: AutoCleanupStateLoadedMessage) => replies.push(message) },
      { type: "stopAutoCleanupNow", requestID: "stop" },
    ),
  ).toBe(true)
  expect(replies).toEqual([
    {
      type: "autoCleanupStateLoaded",
      requestID: "stop",
      last: null,
      progress: undefined,
      pending: false,
      ...(error ? { error } : {}),
    },
  ])
})
