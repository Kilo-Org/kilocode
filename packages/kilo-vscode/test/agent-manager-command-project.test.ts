import { expect, test } from "bun:test"
import path from "node:path"

test("New Worktree reads slash commands from the selected Git project", async () => {
  // Run the Solid browser build without changing module resolution for the rest of the suite.
  const child = Bun.spawn(
    [process.execPath, "--conditions=browser", path.join(import.meta.dir, "fixtures/worktree-command-project.ts")],
    { stdout: "pipe", stderr: "pipe" },
  )
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(code, stdout + stderr).toBe(0)
}, 90_000)
