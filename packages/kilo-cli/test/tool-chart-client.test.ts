import { expect, test } from "bun:test"
import path from "node:path"

const fixture = path.join(import.meta.dir, "fixtures", "chart-client-tools.ts")

function tools(client: "vscode" | "cli") {
  const result = Bun.spawnSync([process.execPath, fixture], {
    env: { ...process.env, KILO_CLIENT: client },
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return JSON.parse(result.stdout.toString()) as { app: string; tools: string[] }
}

test(
  "the chart tool follows the real server client identity",
  () => {
    expect(tools("vscode").app).toBe("vscode")
    expect(tools("vscode").tools).toContain("chart")
    expect(tools("cli").app).toBe("cli")
    expect(tools("cli").tools).not.toContain("chart")
  },
  60_000,
)
