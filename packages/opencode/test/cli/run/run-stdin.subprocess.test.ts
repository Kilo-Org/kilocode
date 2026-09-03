// kilocode_change - new file
// Subprocess test for the abort of the abandoned piped-stdin read.
//
// Promise.race does not cancel its loser: before the abort (run-stdin.ts),
// Bun kept buffering stdin into the abandoned `Bun.stdin.text()` after the
// silence timer won — 64MB written by this harness grew the child by more
// than the write volume of native memory (37MB RSS at the timer, 151MB at
// exit). The timer now aborts the read and cancels the stdin stream, so the
// same write volume must leave the child's RSS flat.
//
// node:child_process (not Bun.spawn) so a write into the full or dead pipe
// surfaces as a catchable stream error instead of killing the harness.
import { afterAll, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const dir = mkdtempSync(join(tmpdir(), "run-stdin-abort-"))

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const childScript = (modulePath: string) => `
import { readPipedStdin } from ${JSON.stringify(modulePath)}
const value = await readPipedStdin({ bound: true, timeoutMs: 200 })
const atTimer = process.memoryUsage.rss()
await Bun.sleep(2500)
const after = process.memoryUsage.rss()
process.stdout.write(JSON.stringify({ value, atTimer, after }) + "\\n")
process.exit(0)
`

test(
  "the abandoned stdin read stops buffering after the silence timer wins",
  async () => {
    const childPath = join(dir, "child.ts")
    await Bun.write(
      childPath,
      childScript(join(import.meta.dir, "..", "..", "..", "src", "cli", "cmd", "run-stdin.ts")),
    )
    const child = spawn(process.execPath, [childPath], { stdio: ["pipe", "pipe", "pipe"] })

    // A write into the full or dead pipe fails asynchronously: the child's
    // exit closes the read end while the harness still holds backed-up
    // writes. Bun 1.4 delivers that as EPIPE, 1.3.14 swallows it. Either way
    // it is the expected consequence of the cancel, so this handler only
    // keeps the stream error from killing the harness.
    child.stdin?.on("error", () => {})
    let out = ""
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString()
    })
    let stderr = ""
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    // Write 64MB while the child sits past its 200ms silence timer. Once the
    // read is cancelled the pipe stays full, so the writes stop landing in
    // child memory; the harness must still attempt the full volume.
    let written = 0
    const chunk = Buffer.alloc(1024 * 1024, 0x61)
    const writer = setInterval(() => {
      if (written >= 64 * 1024 * 1024) {
        clearInterval(writer)
        return
      }
      child.stdin?.write(chunk)
      written += chunk.length
    }, 20)

    await new Promise<void>((resolve) => child.on("exit", () => resolve()))
    clearInterval(writer)

    expect(stderr).toBe("")
    expect(written).toBe(64 * 1024 * 1024)

    const result: { value: string | undefined; atTimer: number; after: number } = JSON.parse(out)
    expect(result.value).toBeUndefined()
    // The abandoned read grew RSS by more than the write volume; with the
    // cancel a flat RSS stays far below half of it.
    expect(result.after - result.atTimer).toBeLessThan(32 * 1024 * 1024)
  },
  30_000,
)
