import { describe, expect, test } from "bun:test"
import path from "node:path"

// The generator is the only writer of contract.generated.ts. `--check` re-lists the pinned server over stdio and
// fails when the vendored file (and with it the SHA-256 the extension handshakes on) drifted from the pin.
const root = path.resolve(import.meta.dir, "..", "..")
const script = path.join(root, "script/generate-browser-tool-contract.ts")

describe("browser contract generator", () => {
  test(
    "the vendored contract matches @playwright/mcp 0.0.81",
    async () => {
      const proc = Bun.spawn([process.execPath, script, "--check"], { cwd: root, stdout: "pipe", stderr: "pipe" })
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      expect(`${stdout}${stderr}${code}`).toEndWith("0")
      expect(stdout).toContain("matches @playwright/mcp@0.0.81 with 26 tools")
    },
    120_000,
  )
})
