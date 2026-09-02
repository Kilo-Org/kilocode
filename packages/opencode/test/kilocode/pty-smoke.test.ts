import { describe, expect, test } from "bun:test"
import { render } from "../../src/kilocode/cli/cmd/pty-smoke"

const run = (source: string, timeout = 3_000) => render(process.execPath, ["-e", source], timeout)
const raw = "process.stdin.setRawMode(true); process.stdin.resume();"
const idle = "setInterval(() => {}, 1000)"

const editor = (delay: number, fps = 60) => `
  import { createCliRenderer, InputRenderable, TextRenderable } from ${JSON.stringify(import.meta.resolve("@opentui/core"))}
  const renderer = await createCliRenderer({ exitOnCtrlC: false, maxFps: ${fps} })
  renderer.root.add(new TextRenderable(renderer, { id: "title", content: "A different startup screen" }))
  const input = new InputRenderable(renderer, { id: "input", width: 40, placeholder: "Type here" })
  renderer.root.add(input)
  setTimeout(() => input.focus(), ${delay})
`

describe("rendered PTY smoke", () => {
  test.each([0, 1_200])("accepts a real renderer with input focus delayed by %dms", async (delay) => {
    await run(editor(delay), 10_000)
  })

  test("preserves pending input when a redraw takes longer than the retry interval", async () => {
    await run(editor(0, 0.5), 15_000)
  })

  test.each([
    ["silent process", ""],
    ["capability queries", "\x1b[?1049h\x1b[6n\x1bP+q4d73\x1b\\\x1b[14t"],
    ["erased output", "\x1b[HTransient text\x1b[2J\x1b[H"],
  ])("rejects a live process with a blank screen: %s", async (_, output) => {
    await expect(run(`${raw} process.stdout.write(${JSON.stringify(output)}); ${idle}`)).rejects.toThrow(
      /timed out during screen/,
    )
  })

  test.each([0, 7])("rejects exit code %d before rendering", async (code) => {
    await expect(run(`process.exit(${code})`)).rejects.toThrow(new RegExp(`exited during screen \\(code ${code},`))
  })

  test("rejects a static screen that ignores input", async () => {
    await expect(run(`${raw} process.stdout.write("Visible but frozen"); ${idle}`)).rejects.toThrow(
      /timed out during input/,
    )
  })

  test.each([
    ["terminal echo", ""],
    ["raw echo", `${raw} process.stdin.on("data", (data) => process.stdout.write(data));`],
  ])("rejects %s without application editing", async (_, source) => {
    await expect(run(`${source} process.stdout.write("Echo is not a TUI"); ${idle}`)).rejects.toThrow(/timed out/)
  })

  test.each(["\x1b]0;", "\x1bP", "\x1b_"])("rejects input echoed only inside control string %j", async (start) => {
    const source = `${raw}
      process.stdout.write("Visible but frozen");
      process.stdin.on("data", (data) => process.stdout.write(${JSON.stringify(start)} + data + "\\x1b\\\\"));
      ${idle}
    `
    await expect(run(source)).rejects.toThrow(/timed out during input/)
  })

  test("rejects input that is drawn and then erased", async () => {
    const source = `${raw}
      process.stdout.write("Visible but frozen");
      process.stdin.on("data", (data) => process.stdout.write(data + "\\x1b[2J\\x1b[H"));
      ${idle}
    `
    await expect(run(source)).rejects.toThrow(/timed out during input/)
  })

  test("rejects a TUI worker diagnostic", async () => {
    await expect(run(`process.stdout.write("TUI worker error: failed to render"); ${idle}`)).rejects.toThrow(
      /TUI diagnostic during screen/,
    )
  })
})
