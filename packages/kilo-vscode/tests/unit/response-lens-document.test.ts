import { test, expect } from "bun:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

test("document parser production Node subprocess integration", () => {
  const script = fileURLToPath(new URL("../fixtures/response-lens-document/integration.mjs", import.meta.url))
  const result = spawnSync("node", ["--test", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 90_000,
    maxBuffer: 1024 * 1024,
  })
  expect(result.error).toBeUndefined()
  expect(result.stdout + result.stderr).not.toContain("not ok")
  expect(result.status, result.stdout + result.stderr).toBe(0)
}, 95_000)
