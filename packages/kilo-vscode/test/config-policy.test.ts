import { describe, expect, test } from "bun:test"
import { configPolicy, displaySettings } from "../src/config-policy"

const targets = { global: "/home/kilo2.json", project: "/repo/.kilo2/kilo2.json" }

describe("configPolicy", () => {
  test("is off and unmanaged when no document sets the value", () => {
    expect(configPolicy([{ path: targets.global, text: "{}" }], targets)).toEqual({
      hidePromptTrainingModels: false,
      managed: false,
    })
  })

  test("reads the last document that sets the value", () => {
    const documents = [
      { path: targets.global, text: '{"hide_prompt_training_models": false}' },
      { path: targets.project, text: '{"hide_prompt_training_models": true}' },
    ]
    expect(configPolicy(documents, targets)).toEqual({ hidePromptTrainingModels: true, managed: false })
  })

  test("is managed when a document outside the writable files sets the value", () => {
    const documents = [
      { path: targets.global, text: '{"hide_prompt_training_models": true}' },
      { path: "/Library/Application Support/kilo/kilo2.json", text: '{"hide_prompt_training_models": false}' },
    ]
    expect(configPolicy(documents, targets)).toEqual({ hidePromptTrainingModels: false, managed: true })
  })

  test("is managed for a document without a path", () => {
    expect(configPolicy([{ text: '{"hide_prompt_training_models": true}' }], targets)).toEqual({
      hidePromptTrainingModels: true,
      managed: true,
    })
  })

  test("ignores a non-boolean value and an unreadable document", () => {
    const documents = [
      { path: targets.project, text: '{"hide_prompt_training_models": true}' },
      { path: targets.global, text: '{"hide_prompt_training_models": "yes"}' },
      { path: "/Library/Application Support/kilo/kilo2.json", text: "not json" },
    ]
    expect(configPolicy(documents, targets)).toEqual({ hidePromptTrainingModels: true, managed: false })
  })
})

describe("displaySettings", () => {
  test("uses the v1 defaults when no document sets a layout", () => {
    expect(displaySettings([{ path: targets.global, text: "{}" }])).toEqual({
      terminalCommandDisplay: "expanded",
      codeEditDisplay: "collapsed",
      mcpToolDisplay: "collapsed",
      codeModeDisplay: "collapsed",
      reasoningDisplay: "expanded",
    })
  })

  test("reads each layout from the last document that sets it", () => {
    const documents = [
      {
        path: targets.global,
        text: '{"terminal_command_display": "collapsed", "code_edit_display": "expanded"}',
      },
      { path: targets.project, text: '{"terminal_command_display": "expanded", "mcp_tool_display": "expanded"}' },
    ]
    expect(displaySettings(documents)).toEqual({
      terminalCommandDisplay: "expanded",
      codeEditDisplay: "expanded",
      mcpToolDisplay: "expanded",
      codeModeDisplay: "collapsed",
      reasoningDisplay: "expanded",
    })
  })

  test("keeps the default for an invalid layout and an unreadable document", () => {
    const documents = [
      { path: targets.global, text: '{"terminal_command_display": "hidden", "mcp_tool_display": "expanded"}' },
      { path: targets.project, text: "not json" },
    ]
    expect(displaySettings(documents)).toEqual({
      terminalCommandDisplay: "expanded",
      codeEditDisplay: "collapsed",
      mcpToolDisplay: "expanded",
      codeModeDisplay: "collapsed",
      reasoningDisplay: "expanded",
    })
  })

  test("reads the reasoning mode and lets an explicit mode win over the legacy boolean", () => {
    const documents = [
      { path: targets.global, text: '{"auto_collapse_reasoning": true}' },
      { path: targets.project, text: '{"reasoning_display": "headline"}' },
    ]
    expect(displaySettings(documents).reasoningDisplay).toBe("headline")
  })

  test("maps the legacy auto_collapse_reasoning boolean to preview or expanded", () => {
    expect(
      displaySettings([{ path: targets.global, text: '{"auto_collapse_reasoning": true}' }]).reasoningDisplay,
    ).toBe("preview")
    expect(
      displaySettings([
        { path: targets.global, text: '{"auto_collapse_reasoning": true}' },
        { path: targets.project, text: '{"auto_collapse_reasoning": false}' },
      ]).reasoningDisplay,
    ).toBe("expanded")
  })

  test("ignores an invalid reasoning mode", () => {
    expect(
      displaySettings([{ path: targets.global, text: '{"reasoning_display": "collapsed"}' }]).reasoningDisplay,
    ).toBe("expanded")
  })
})
