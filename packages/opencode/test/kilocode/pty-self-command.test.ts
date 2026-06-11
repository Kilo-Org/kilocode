import { describe, expect, test } from "bun:test"
import { KiloPtySelfCommand } from "../../src/kilocode/pty/self-command"

describe("pty self-command", () => {
  test("does not forward bundled bun entrypoints", () => {
    const proc = {
      argv: ["/tmp/kilo", "/$bunfs/root/src/index.js"],
      execArgv: ["--user-agent=kilo/test", "--use-system-ca", "--"],
      execPath: "/tmp/kilo",
      cwd: "/tmp",
    }

    const cmd = KiloPtySelfCommand.command(proc)
    expect(cmd).toStrictEqual({ command: "/tmp/kilo", args: [] })
    expect(
      KiloPtySelfCommand.resolve({ command: "kilo", cwd: "/tmp/project" }, cmd),
    ).toStrictEqual({ command: "/tmp/kilo", args: [], cwd: "/tmp/project" })
    expect(
      KiloPtySelfCommand.command({
        ...proc,
        argv: ["C:/tmp/kilo.exe", "B:/~BUN/root/src/index.js"],
      }).args,
    ).toStrictEqual([])
    expect(
      KiloPtySelfCommand.command({
        ...proc,
        argv: ["C:/tmp/kilo.exe", "b:\\~BUN\\root\\src\\index.js"],
      }).args,
    ).toStrictEqual([])
  })

  test("forwards source entrypoints", () => {
    const cmd = KiloPtySelfCommand.command({
      argv: ["/tmp/bun", "/tmp/kilo/src/index.ts"],
      execArgv: ["--conditions=browser", "--cwd", "packages/opencode"],
      execPath: "/tmp/bun",
      cwd: "/tmp/kilo",
    })
    expect(cmd).toStrictEqual({
      command: "/tmp/bun",
      args: ["--conditions=browser", "/tmp/kilo/src/index.ts"],
      cwd: "/tmp/kilo",
    })
    expect(
      KiloPtySelfCommand.resolve({ command: "kilo", cwd: "/tmp/project" }, cmd),
    ).toStrictEqual({
      command: "/tmp/bun",
      args: ["--conditions=browser", "/tmp/kilo/src/index.ts", "/tmp/project"],
      cwd: "/tmp/kilo",
    })
  })
})
