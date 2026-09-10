import { expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { fixture } from "../../kilo-cli/test/fixture"

test.skipIf(process.platform !== "darwin")(
  "existing UI session contract uses native v2 admission and history",
  async () => {
    await using input = await fixture()
    const policy = path.join(input.directory, "network.sb")
    await writeFile(
      policy,
      '(version 1) (allow default) (deny network-outbound) (allow network-outbound (remote ip "localhost:*"))',
    )
    const child = Bun.spawn(
      [
        "/usr/bin/sandbox-exec",
        "-f",
        policy,
        process.execPath,
        path.join(import.meta.dir, "backend-session-fixture.ts"),
      ],
      { cwd: input.cwd, env: input.env, stdout: "pipe", stderr: "pipe" },
    )
    const timeout = setTimeout(() => child.kill("SIGKILL"), 25_000)
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect({ code, error: code ? stdout + stderr : "" }).toEqual({ code: 0, error: "" })
      expect(stdout).toContain("EXISTING_UI_SESSION_PASS")
    } finally {
      clearTimeout(timeout)
    }
  },
  30_000,
)
