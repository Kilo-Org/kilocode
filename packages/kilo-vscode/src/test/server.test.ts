import * as assert from "assert"
import { checkHealth, discoverServer } from "../server"

suite("Server Discovery Test Suite", () => {
  test("checkHealth returns null for non-existent server", async () => {
    const result = await checkHealth("http://localhost:59999")
    assert.strictEqual(result, null)
  })

  test("checkHealth returns null for invalid URL", async () => {
    const result = await checkHealth("http://invalid-host-that-does-not-exist:4096")
    assert.strictEqual(result, null)
  })

  test("discoverServer returns expected shape", async () => {
    const result = await discoverServer()
    assert.ok(result === null || (typeof result.url === "string" && typeof result.version === "string"))
  })
})
