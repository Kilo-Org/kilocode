import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { exec } from "../src/util/process"

test("the packaged proxy worker fails closed and releases sockets on teardown", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kilo-browser-proxy-"))
  try {
    const result = await Bun.build({
      entrypoints: [
        join(import.meta.dir, "../src/services/browser-automation/browser-proxy-worker.ts"),
        join(import.meta.dir, "fixtures/browser-proxy-lifecycle.ts"),
      ],
      outdir: dir,
      naming: "[name].[ext]",
      target: "node",
      format: "cjs",
    })
    expect(result.success).toBe(true)
    const output = await exec("node", ["--test-reporter=tap", join(dir, "browser-proxy-lifecycle.js")], {
      timeout: 10_000,
    })
    expect(output.stdout).toMatch(/^# pass 3$/m)
    expect(output.stderr).toBe("")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 15_000)
