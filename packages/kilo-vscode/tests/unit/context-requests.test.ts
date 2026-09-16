import { expect, test } from "bun:test"
import { createContextRequests } from "../../webview-ui/src/hooks/context-requests"

test("context requests settle by ID, time out, and preserve cleanup semantics", async () => {
  const ctx = createContextRequests("context", 5, "Timed out")
  const first = ctx.request(() => {}).catch((err: Error) => err.message)
  const second = ctx.request((id) => ctx.settle(id, (req) => req.resolve("second")))
  await expect(second).resolves.toBe("second")
  ctx.settle("context-2", () => {
    throw new Error("Late settlement")
  })
  expect(ctx.pending()).toBe(true)
  await expect(first).resolves.toBe("Timed out")
  expect(ctx.pending()).toBe(false)

  for (const reset of [false, true]) {
    const result = ctx.request(() => {}).catch((err: Error) => err.message)
    ctx.dispose("Cancelled", reset)
    await expect(result).resolves.toBe("Cancelled")
    expect(ctx.pending()).toBe(!reset)
  }
})
