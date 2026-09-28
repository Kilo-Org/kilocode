import { describe, expect, it } from "bun:test"
import path from "node:path"

describe("session preference loader", () => {
  it.each(["exhaustion", "offline", "reconnect", "retry", "ready", "cleanup", "loaded", "synchronous"])(
    "%s uses the production helper with browser Solid reactivity",
    (name) => {
      const child = Bun.spawnSync(
        [
          process.execPath,
          "--conditions=browser",
          path.join(import.meta.dir, "../fixtures/session-preference-loader.ts"),
          name,
        ],
        { cwd: path.join(import.meta.dir, "../../webview-ui"), stdout: "pipe", stderr: "pipe" },
      )
      expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
    },
  )
})
