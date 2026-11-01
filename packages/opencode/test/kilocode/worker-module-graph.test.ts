// kilocode_change - new file
import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

/**
 * The TUI worker's module graph must initialize when entered through the server.
 *
 * `src/cli/tui/worker.ts` imports `@/server/server` first, so that module — not the CLI — is the
 * root of the graph in a worker. A static import cycle that the CLI's own entry order happens to
 * survive will throw here instead, as a `ReferenceError: Cannot access 'X' before initialization`
 * from whichever module was still in its temporal dead zone.
 *
 * The failure is close to invisible in production: the worker dies, `worker.onerror` writes to a
 * console the TUI has already replaced with the alternate screen buffer, and the TUI then waits
 * forever on its first RPC to a worker that is gone — a blank terminal and no error at all. So the
 * guard belongs in a test, and it has to run in its own process: a shared module registry would
 * have warmed the graph through some other entry long before the assertion.
 */
test("the TUI worker's graph initializes with the server as its entry", async () => {
  const root = new URL("../../", import.meta.url)
  const entry = new URL("src/server/server.ts", root)
  const code = `await import(${JSON.stringify(entry.href)})`

  const proc = Bun.spawn([process.execPath, "--conditions=node", "--eval", code], {
    cwd: fileURLToPath(root),
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  })
  const [exit, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])

  expect({ exit, initializationError: /before initialization/.test(stderr) }).toEqual({
    exit: 0,
    initializationError: false,
  })
})
