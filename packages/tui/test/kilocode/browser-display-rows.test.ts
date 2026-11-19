// Every row outside the main transcript's tool renderers masks browser typed text too: `kilo mini` scrollback and the
// expanded turn-token table.
import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import { entryBody } from "../../src/mini/entry.body"
import { normalizeTool, toolInlineInfo } from "../../src/mini/tool"
import type { StreamCommit } from "../../src/mini/types"
import { turnTokenToolSummary } from "../../src/routes/session"
import { canonicalToolPart } from "../mini/fixture/tool-part"

const password = "hunter2"

/** A Code Mode program that types the password, the shape `execute` receives. */
const code = `await browser.type({ target: "e2", text: "${password}" })`

const typed = (status: "running" | "completed") =>
  canonicalToolPart(
    "browser_type",
    status === "running"
      ? { status, input: { target: "e2", text: password }, metadata: {} }
      : { status, input: { target: "e2", text: password }, metadata: {}, content: [{ type: "text", text: "" }] },
  )

const program = canonicalToolPart("execute", {
  status: "completed",
  input: { code: "await browser.snapshot()" },
  metadata: {
    toolCalls: [
      { tool: "browser.type", status: "completed", input: { target: "e2", text: password } },
      { tool: "browser.handle_dialog", status: "completed", input: { accept: true, promptText: password } },
      { tool: "browser.navigate", status: "completed", input: { url: "https://example.com" } },
    ],
  },
  content: [{ type: "text", text: "" }],
})

function commit(part: SessionMessageAssistantTool, phase: StreamCommit["phase"]): StreamCommit {
  return {
    kind: "tool",
    text: "",
    phase,
    source: "tool",
    tool: part.name,
    toolState: part.state.status === "completed" ? "completed" : "running",
    part,
  }
}

function shown(part: SessionMessageAssistantTool, phase: StreamCommit["phase"]) {
  return JSON.stringify(entryBody(commit(part, phase)))
}

describe("browser typed text outside the transcript", () => {
  test("mini normalizes a browser_type call to masked input", () => {
    const tool = normalizeTool(typed("running"))
    expect(tool.state.status === "streaming" ? undefined : tool.state.input).toEqual({ target: "e2", text: "•••" })
  })

  test("mini's start row and inline summary mask the typed text", () => {
    expect(shown(typed("running"), "start")).toContain("text=•••")
    expect(shown(typed("running"), "start")).not.toContain(password)
    expect(toolInlineInfo(typed("completed")).title).not.toContain(password)
  })

  test("mini's Code Mode final body masks nested browser calls and keeps the rest", () => {
    const body = shown(program, "final")
    expect(body).not.toContain(password)
    expect(body).toContain("https://example.com")
  })

  test("the turn-token table masks the typed text", () => {
    expect(turnTokenToolSummary(typed("completed"))).toBe("target: e2  text: •••")
    const streaming = canonicalToolPart("browser_type", { status: "streaming", input: `{"text":"${password}` })
    expect(turnTokenToolSummary(streaming)).not.toContain(password)
  })

  test("mini's one-line Code Mode rows leave out the program, which can type text", () => {
    const typing = canonicalToolPart("execute", {
      status: "running",
      input: { code: `await browser.type({ target: "e2", text: "${password}" })` },
      metadata: {},
    })
    expect(shown(typing, "start")).not.toContain(password)
    expect(toolInlineInfo(typing).title).not.toContain(password)
  })

  test("the turn-token table leaves out a Code Mode program, which can type text", () => {
    const done = canonicalToolPart("execute", { status: "completed", input: { code }, metadata: {} })
    expect(turnTokenToolSummary(done)).not.toContain(password)
    // Streaming, the program is raw JSON text: no fragment of it may reach the row either.
    const streaming = canonicalToolPart("execute", {
      status: "streaming",
      input: `{"code":${JSON.stringify(code.slice(0, code.indexOf(password) + password.length))}`,
    })
    expect(turnTokenToolSummary(streaming)).not.toContain(password)
  })
})
