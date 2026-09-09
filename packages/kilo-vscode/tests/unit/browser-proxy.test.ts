import { expect, test } from "bun:test"
import { node } from "../fixtures/node"

test("browser proxy protocols run in the extension host's Node runtime", async () => {
  const result = await node("browser-proxy", { timeout: 20_000 })
  expect(result.stdout).toMatch(/^# tests 28$/m)
  expect(result.stdout).toMatch(/^# pass 28$/m)
  expect(result.stdout).toMatch(/^# skipped 0$/m)
  expect(result.stdout).toMatch(/^# fail 0$/m)
  expect(result.stdout).toMatch(/^# cancelled 0$/m)
}, 30_000)
