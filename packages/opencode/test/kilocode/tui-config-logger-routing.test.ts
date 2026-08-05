import { afterEach, describe, expect, test } from "bun:test"
import * as Log from "@opencode-ai/core/util/log"
import { KilocodeTuiConfig } from "@/kilocode/tui/config"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

void Log.init({ print: false })

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

// kilocode_change - regression test: direct calls must not leak Effect logs to the shared TTY
const LEAKED = ["loading tui config", "applying tui config", "skipping invalid tui config", "failed to read tui config"]

async function withConsoleCapture<T>(fn: () => Promise<T>): Promise<{ stdout: string; result: T }> {
  const original = console.log
  let captured = ""
  console.log = (...args: unknown[]) => {
    captured += args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n"
  }
  try {
    const result = await fn()
    return { stdout: captured, result }
  } finally {
    console.log = original
  }
}

describe("KilocodeTuiConfig.get logger routing", () => {
  test("does not leak internal Effect logs through Effect's default logger", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const cfg = path.join(dir, ".kilo")
        await fs.mkdir(cfg, { recursive: true })
        await Bun.write(path.join(cfg, "tui.json"), JSON.stringify({ theme: "dracula" }, null, 2))
      },
    })

    const { stdout, result } = await withConsoleCapture(() => KilocodeTuiConfig.get({ directory: tmp.path }))
    expect(result.theme).toBe("dracula")
    for (const message of LEAKED) {
      expect(stdout).not.toContain(message)
    }
  })

  test("does not leak warnings from invalid config files", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const cfg = path.join(dir, ".kilo")
        await fs.mkdir(cfg, { recursive: true })
        await Bun.write(path.join(cfg, "tui.json"), "{ this is not valid jsonc }")
      },
    })

    const { stdout, result } = await withConsoleCapture(() => KilocodeTuiConfig.get({ directory: tmp.path }))
    expect(result).toBeTypeOf("object")
    for (const message of LEAKED) {
      expect(stdout).not.toContain(message)
    }
  })
})
