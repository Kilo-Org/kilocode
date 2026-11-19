import { describe, expect, test } from "bun:test"
import { browserDisplayCalls, browserDisplayInput } from "../../src/kilocode/browser-display"
import { subagentToolLabel } from "../../src/routes/session"
import { executeCallSummary, primitiveInputSummary } from "../../src/util/tool-display"

const password = "hunter2"

describe("browser tool rows", () => {
  test("a Code Mode browser.type row masks the typed text", () => {
    const [call] = browserDisplayCalls([
      {
        tool: "browser.type",
        status: "running" as const,
        input: { element: "the password field", target: "e2", text: password },
      },
    ])
    expect(executeCallSummary(call!)).toBe("browser.type [element=the password field, target=e2, text=•••]")
    expect(JSON.stringify(call)).not.toContain(password)
  })

  test("a direct browser_type call masks the typed text and keeps the rest", () => {
    const input = browserDisplayInput("browser_type", { target: "e2", text: password, submit: true })
    expect(primitiveInputSummary(input)).toBe("[target=e2, text=•••, submit=true]")
  })

  test("browser_fill_form masks typed values and keeps choices", () => {
    const input = browserDisplayInput("browser.fill_form", {
      fields: [
        { name: "Password", type: "textbox", target: "e1", value: password },
        { name: "Card", type: "combobox", target: "e2", value: "Visa" },
        { name: "Remember me", type: "checkbox", target: "e3", value: "true" },
      ],
    })
    expect(input.fields).toEqual([
      { name: "Password", type: "textbox", target: "e1", value: "•••" },
      { name: "Card", type: "combobox", target: "e2", value: "•••" },
      { name: "Remember me", type: "checkbox", target: "e3", value: "true" },
    ])
  })

  test("browser_fill_form hides every value when a field is not an object", () => {
    const input = browserDisplayInput("browser_fill_form", {
      fields: ["stray", { name: "Password", type: "textbox", target: "e1", value: password }],
    })
    expect(JSON.stringify(input)).not.toContain(password)
    expect(primitiveInputSummary(input)).not.toContain(password)
  })

  test("browser_fill_form hides fields that are not an array", () => {
    const input = browserDisplayInput("browser.fill_form", { fields: { Password: password } })
    expect(JSON.stringify(input)).not.toContain(password)
    expect(primitiveInputSummary(input)).not.toContain(password)
  })

  test("browser_type masks text that is not a string", () => {
    for (const text of [1234567, { value: password }]) {
      const input = browserDisplayInput("browser_type", { target: "e2", text })
      expect(JSON.stringify(input)).not.toContain(password)
      expect(JSON.stringify(input)).not.toContain("1234567")
      expect(primitiveInputSummary(input)).toBe("[target=e2, text=•••]")
    }
  })

  test("browser_handle_dialog masks the prompt text and keeps the choice", () => {
    for (const tool of ["browser_handle_dialog", "browser.handle_dialog"]) {
      const input = browserDisplayInput(tool, { accept: true, promptText: password })
      expect(primitiveInputSummary(input)).toBe("[accept=true, promptText=•••]")
    }
  })

  test("browser_drop masks every data value and keeps the MIME types and paths", () => {
    const input = browserDisplayInput("browser.drop", {
      target: "e4",
      paths: ["/tmp/a.png"],
      data: { "text/plain": password, "text/uri-list": "https://example.com" },
    })
    expect(input).toEqual({
      target: "e4",
      paths: ["/tmp/a.png"],
      data: { "text/plain": "•••", "text/uri-list": "•••" },
    })
  })

  test("browser_drop hides data that is not a map", () => {
    for (const data of [password, [password]]) {
      const input = browserDisplayInput("browser_drop", { target: "e4", data })
      expect(JSON.stringify(input)).not.toContain(password)
    }
  })

  test("every other tool's input is unchanged", () => {
    const navigate = { url: "https://example.com" }
    expect(browserDisplayInput("browser.navigate", navigate)).toBe(navigate)
    const write = { path: "a.txt", text: "kept" }
    expect(browserDisplayInput("write", write)).toBe(write)
  })

  test("a subagent's live child line masks the typed text", () => {
    const part = {
      type: "tool",
      id: "call_type",
      name: "browser_type",
      state: { status: "running", input: { target: "e2", text: password }, metadata: {} },
    }
    expect(subagentToolLabel(part as never)).toBe("Browser_type [target=e2, text=•••]")
  })
})
