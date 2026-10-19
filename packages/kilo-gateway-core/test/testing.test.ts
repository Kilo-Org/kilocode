import { expect, test } from "bun:test"
import { fixture } from "../src/testing"

// The startup ratchet sets `state.delay` so a plugin that waits for the network during activation shows the delay.
// Keep the fixture honest: without this, a dropped delay would make the ratchet pass at 0 ms.
test("the fixture answers after the configured delay", async () => {
  using backend = fixture()
  backend.state.delay = 50
  const start = performance.now()
  const response = await fetch(new URL("/api/defaults", backend.url))
  expect(response.status).toBe(200)
  expect(performance.now() - start).toBeGreaterThanOrEqual(50)
})
