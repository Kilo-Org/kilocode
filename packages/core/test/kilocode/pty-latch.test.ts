import { expect, test } from "bun:test"
import { spawn } from "../../src/pty/pty.bun"

const run = process.platform === "win32" ? test.skip : test

// bun-pty fires each event once from its read loop. Without the latch, a child that exits
// before the caller attaches listeners loses both its output and its exit (0/20 delivered).
run("replays output and exit to listeners attached after the child exited", async () => {
  const proc = spawn("sh", ["-c", 'printf "early"; exit 7'], {
    name: "xterm",
    cwd: "/tmp",
    env: { PATH: process.env.PATH ?? "" },
  })
  await Bun.sleep(300)

  const chunks: string[] = []
  const exit = Promise.withResolvers<{ exitCode: number }>()
  proc.onData((chunk) => chunks.push(chunk))
  proc.onExit((event) => exit.resolve(event))

  const timeout = Bun.sleep(3000).then(() => {
    throw new Error("timed out waiting for replayed exit")
  })
  expect(await Promise.race([exit.promise, timeout])).toEqual({ exitCode: 7 })
  expect(chunks.join("")).toContain("early")
})

run("does not replay to a listener disposed before the microtask runs", async () => {
  const proc = spawn("sh", ["-c", "exit 0"], { name: "xterm", cwd: "/tmp", env: { PATH: process.env.PATH ?? "" } })
  await Bun.sleep(300)

  const seen: unknown[] = []
  proc.onExit((event) => seen.push(event)).dispose()
  await Bun.sleep(50)
  expect(seen).toEqual([])
})
