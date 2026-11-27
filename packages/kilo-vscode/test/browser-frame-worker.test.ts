import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { exec } from "../src/util/process"

test("the bundled Node capture worker preserves frame and stream lifecycle boundaries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kilo-browser-frames-"))
  try {
    const build = await Bun.build({
      entrypoints: [
        join(import.meta.dir, "../src/services/browser-automation/browser-frame-worker.ts"),
        join(import.meta.dir, "fixtures/browser-frame-lifecycle.ts"),
      ],
      outdir: dir,
      naming: "[name].[ext]",
      target: "node",
      format: "cjs",
    })
    expect(build.success).toBe(true)
    const output = await exec("node", ["--test-reporter=tap", join(dir, "browser-frame-lifecycle.js")], {
      timeout: 15_000,
    })
    expect(output.stdout).toMatch(/^# pass 7$/m)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 20_000)
