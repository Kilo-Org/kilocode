/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RunInteractiveTerminalBody } from "@/kilocode/cli/cmd/run/interactive-terminal"
import { RUN_THEME_FALLBACK } from "@/cli/cmd/run/theme"

test("mounted terminal takes keyboard input and exposes takeover controls", async () => {
  const writes: string[] = []
  const resizes: Array<{ terminalID: string; cols: number; rows: number }> = []
  const app = await testRender(
    () => (
      <box width={100} height={18}>
        <RunInteractiveTerminalBody
          terminal={() => ({
            info: {
              id: "itx_terminal",
              sessionID: "ses_terminal",
              pid: 123,
              command: "node prompt.mjs",
              cwd: "/tmp",
              description: "Enter authentication code",
              status: "running",
              cols: 80,
              rows: 14,
              time: { started: 1, updated: 1 },
            },
            output: "Code: ",
            cursor: 6,
          })}
          theme={RUN_THEME_FALLBACK.footer}
          onWrite={async (input) => {
            writes.push(input.data)
          }}
          onResize={async (input) => {
            resizes.push(input)
          }}
          onClose={async () => {}}
        />
      </box>
    ),
    { width: 100, height: 18 },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("TERMINAL INPUT ACTIVE")
    expect(app.captureCharFrame()).toContain("ctrl+c interrupt")
    expect(app.captureCharFrame()).toContain("esc close")
    expect(resizes).toEqual([expect.objectContaining({ terminalID: "itx_terminal", rows: 14 })])

    app.mockInput.pressKey("4")
    app.mockInput.pressEnter()
    await app.renderOnce()
    await Promise.resolve()
    expect(writes.join("")).toContain("4")
  } finally {
    app.renderer.destroy()
  }
})

test("terminal surfaces write failures instead of swallowing them", async () => {
  const app = await testRender(
    () => (
      <box width={100} height={18}>
        <RunInteractiveTerminalBody
          terminal={() => ({
            info: {
              id: "itx_terminal",
              sessionID: "ses_terminal",
              pid: 123,
              command: "node prompt.mjs",
              cwd: "/tmp",
              status: "running",
              cols: 80,
              rows: 14,
              time: { started: 1, updated: 1 },
            },
            output: "Code: ",
            cursor: 6,
          })}
          theme={RUN_THEME_FALLBACK.footer}
          onWrite={async () => {
            throw new Error("socket disconnected")
          }}
          onResize={async () => {}}
          onClose={async () => {}}
        />
      </box>
    ),
    { width: 100, height: 18 },
  )

  try {
    await app.renderOnce()
    app.mockInput.pressKey("x")
    await Bun.sleep(10)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("input failed: socket disconnected")
  } finally {
    app.renderer.destroy()
  }
})
