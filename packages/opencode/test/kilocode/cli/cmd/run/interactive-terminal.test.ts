import { expect, test } from "bun:test"
import type { Event, ToolPart } from "@kilocode/sdk/v2"
import { createSessionData, reduceSessionData } from "@/cli/cmd/run/session-data"
import { toolInlineInfo } from "@/cli/cmd/run/tool"

function part(): ToolPart {
  return {
    id: "prt_terminal",
    sessionID: "ses_terminal",
    messageID: "msg_terminal",
    type: "tool",
    callID: "call_terminal",
    tool: "interactive_terminal",
    state: {
      status: "completed",
      input: {
        command: "python3 prompt.py",
        description: "Prompt for name interactively",
        workdir: "/tmp",
      },
      output: "Type your name: Ada",
      metadata: {
        terminalID: "itx_terminal",
        exitCode: 0,
        closedBy: "exit",
      },
      title: "Prompt for name interactively",
      time: { start: 1, end: 2 },
    },
  }
}

function reduce(data: ReturnType<typeof createSessionData>, event: unknown) {
  return reduceSessionData({
    data,
    event: event as Event,
    sessionID: "session-1",
    thinking: true,
    limits: {},
  })
}

test("formats interactive_terminal without a generic argument dump", () => {
  expect(toolInlineInfo(part())).toEqual({
    icon: "$",
    title: "Prompt for name interactively",
    description: "$ python3 prompt.py",
  })
})

test("drives the direct interactive terminal footer from terminal events", () => {
  const data = createSessionData()
  const opened = reduce(data, {
    type: "interactive_terminal.updated",
    properties: {
      info: {
        id: "itx_1",
        sessionID: "session-1",
        pid: 123,
        command: "python3 prompt.py",
        cwd: "/tmp",
        description: "Prompt for input",
        status: "running",
        cols: 80,
        rows: 14,
        time: { started: 1, updated: 1 },
      },
    },
  })
  expect(opened.footer?.view).toEqual(
    expect.objectContaining({
      type: "interactive_terminal",
      terminal: expect.objectContaining({ output: "", cursor: 0 }),
    }),
  )

  const streamed = reduce(data, {
    type: "interactive_terminal.data",
    properties: {
      terminalID: "itx_1",
      sessionID: "session-1",
      data: "Type your name: ",
      cursor: 16,
    },
  })
  expect(streamed.footer?.view).toEqual(
    expect.objectContaining({
      type: "interactive_terminal",
      terminal: expect.objectContaining({ output: "Type your name: ", cursor: 16 }),
    }),
  )

  const closed = reduce(data, {
    type: "interactive_terminal.deleted",
    properties: { terminalID: "itx_1", sessionID: "session-1" },
  })
  expect(closed.footer?.view).toEqual({ type: "prompt" })
})
