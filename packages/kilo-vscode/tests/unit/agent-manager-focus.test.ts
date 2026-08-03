import { describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import { focusQuestionOption, hasQuestionOption } from "../../webview-ui/agent-manager/focus"

describe("Agent Manager focus", () => {
  it("focuses the first enabled question option", () => {
    const window = new Window()
    const root = window.document.createElement("div")
    const dock = window.document.createElement("div")
    const disabled = window.document.createElement("button")
    const option = window.document.createElement("button")
    disabled.setAttribute("data-slot", "question-option")
    disabled.disabled = true
    option.setAttribute("data-slot", "question-option")
    dock.setAttribute("data-component", "question-dock")
    dock.append(disabled, option)
    root.append(dock)
    window.document.body.append(root)

    expect(focusQuestionOption(root)).toBe(true)
    expect(root.ownerDocument.activeElement).toBe(option)
  })

  it("ignores collapsed question bodies", () => {
    const window = new Window()
    const root = window.document.createElement("div")
    const dock = window.document.createElement("div")
    const body = window.document.createElement("div")
    const option = window.document.createElement("button")
    dock.setAttribute("data-component", "question-dock")
    body.setAttribute("inert", "")
    option.setAttribute("data-slot", "question-option")
    body.append(option)
    dock.append(body)
    root.append(dock)
    window.document.body.append(root)

    expect(focusQuestionOption(root)).toBe(false)
    expect(root.ownerDocument.activeElement).not.toBe(option)
  })

  it("only reports enabled options outside inert bodies", () => {
    const window = new Window()
    const root = window.document.createElement("div")
    const dock = window.document.createElement("div")
    const option = window.document.createElement("button")
    dock.setAttribute("data-component", "question-dock")
    option.setAttribute("data-slot", "question-option")
    dock.append(option)
    root.append(dock)

    expect(hasQuestionOption(root)).toBe(true)
    dock.setAttribute("inert", "")
    expect(hasQuestionOption(root)).toBe(false)
  })
})
