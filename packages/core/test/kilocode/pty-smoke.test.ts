import { expect, test } from "bun:test"
import { PtySmoke } from "../../src/kilocode/pty/smoke"

// A fake shell that drops all input it reads during startup, like pwsh under ConPTY.
const shell = `
  const start = Date.now()
  const state = { buf: "" }
  process.stdin.setRawMode(true)
  process.stdin.on("data", (data) => {
    if (Date.now() - start < 1_500) return
    state.buf += data.toString()
    const lines = state.buf.split("\\r")
    state.buf = lines.pop() ?? ""
    for (const line of lines) {
      if (line.startsWith("echo ")) process.stdout.write(line.slice(5) + "\\r\\n")
      if (line.startsWith("exit ")) process.exit(Number(line.slice(5)))
    }
  })
  process.stdout.write("fake shell\\r\\n")
`

test("resends the probe when the shell drops early input", async () => {
  await expect(PtySmoke.smoke(process.execPath, ["-e", shell])).resolves.toBeUndefined()
}, 20_000)
