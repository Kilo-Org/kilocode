import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Layer } from "effect"
import { AppProcess } from "@opencode-ai/core/process"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { RipgrepBinary } from "@opencode-ai/core/ripgrep/binary"
import { tmpdir } from "../fixture/tmpdir"
import { it } from "../lib/effect"

const record = (line: number) =>
  JSON.stringify({
    type: "match",
    data: {
      path: { text: "fixture.ts" },
      lines: { text: "needle\n" },
      line_number: line,
      absolute_offset: line * 10,
      submatches: [{ match: { text: "needle" }, start: 0, end: 6 }],
    },
  })

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const gone = async (pid: number) => {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    if (!alive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return !alive(pid)
}

describe("Kilo ripgrep settlement", () => {
  it.live(
    "settles a bounded grep after its command exits",
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          if (process.platform === "win32") return

          const binary = path.join(tmp.path, "rg")
          const retained = path.join(tmp.path, "retained.pid")
          const owned = path.join(tmp.path, "owned.pid")
          const output = Array.from({ length: 300 }, (_, index) => record(index + 1)).join("\n") + "\n"
          const source = `#!${process.execPath}
const { spawn } = require("node:child_process")
const { writeFileSync } = require("node:fs")
const retained = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 3_000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
})
retained.unref()
const owned = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 10_000)"], {
  stdio: "ignore",
})
owned.unref()
writeFileSync(${JSON.stringify(retained)}, String(retained.pid))
writeFileSync(${JSON.stringify(owned)}, String(owned.pid))
require("node:fs").writeSync(1, ${JSON.stringify(output)})
`
          yield* Effect.promise(() => fs.writeFile(binary, source, { mode: 0o755 }))
          yield* Effect.addFinalizer(() =>
            Effect.promise(async () => {
              for (const file of [retained, owned]) {
                const pid = Number(await fs.readFile(file, "utf8").catch(() => ""))
                if (!pid || !alive(pid)) continue
                try {
                  process.kill(pid, "SIGKILL")
                } catch {}
              }
            }),
          )

          const fixture = Layer.succeed(
            RipgrepBinary.Service,
            RipgrepBinary.Service.of({ filepath: Effect.succeed(binary) }),
          )
          const layer = Ripgrep.layer.pipe(Layer.provide(Layer.merge(AppProcess.defaultLayer, fixture)))
          const started = Date.now()
          const result = yield* Ripgrep.Service.pipe(
            Effect.flatMap((ripgrep) =>
              ripgrep.grep({ cwd: tmp.path, pattern: "needle", limit: 1 }),
            ),
            Effect.provide(layer),
          )
          const retainedPid = Number(yield* Effect.promise(() => fs.readFile(retained, "utf8")))
          const ownedPid = Number(yield* Effect.promise(() => fs.readFile(owned, "utf8")))

          expect(result.truncated).toBe(true)
          expect(Date.now() - started).toBeLessThan(1_000)
          expect(retainedPid).toBeGreaterThan(0)
          expect(yield* Effect.promise(() => gone(ownedPid))).toBe(true)
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
    5_000,
  )
})
