import { describe, expect, test } from "bun:test"
import { render } from "../../src/kilocode/pty/smoke"

const run = (source: string, timeout = 3_000) => render(process.execPath, ["-e", source], timeout)

describe("rendered PTY smoke", () => {
  test("accepts chunked terminal redraws and a responsive command palette", async () => {
    const source = [
      "if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true)",
      'process.stdout.write("\\x1b[2J\\x1b[HAsk any" + "\\r\\n".repeat(39) + "\\x1b[1;8H")',
      'setTimeout(() => process.stdout.write("thing..."), 20)',
      'process.stdin.on("data", (data) => {',
      '  if (!data.toString().includes("\\x10")) return',
      '  process.stdout.write("\\x1b[2J\\x1b[HCom" + "\\r\\n".repeat(39) + "\\x1b[1;4H")',
      '  setTimeout(() => process.stdout.write("mands"), 20)',
      "})",
      "setInterval(() => {}, 1000)",
    ].join("\n")

    await run(source)
  })

  test("times out when output has no visible prompt", async () => {
    const source = 'process.stdout.write("\\x1b[2J\\x1b[H\\x1b[?25l\\r\\n"); setInterval(() => {}, 1000)'

    await expect(run(source)).rejects.toThrow(/timed out during prompt/)
  })

  test("rejects a zero exit before the prompt", async () => {
    const source = 'process.stdout.write("started"); setTimeout(() => process.exit(0), 20)'

    await expect(run(source)).rejects.toThrow(/exited during prompt \(code 0,/)
  })

  test("rejects a nonzero exit before the prompt", async () => {
    const source = 'process.stdout.write("started"); setTimeout(() => process.exit(7), 20)'

    await expect(run(source)).rejects.toThrow(/exited during prompt \(code 7,/)
  })

  test("times out when the prompt ignores the palette key", async () => {
    const source = 'process.stdout.write("\\x1b[2J\\x1b[HAsk anything..."); setInterval(() => {}, 1000)'

    await expect(run(source)).rejects.toThrow(/timed out during palette/)
  })

  test("rejects a TUI worker diagnostic before bundled source text", async () => {
    const source =
      'process.stdout.write("rendered: TUI worker error Error: Ask anything...\\nconst source = \\\"Commands\\\"\\n"); setInterval(() => {}, 1000)'

    await expect(run(source)).rejects.toThrow(/TUI diagnostic during prompt/)
  })
})
