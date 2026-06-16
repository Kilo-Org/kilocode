// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { createBindingLookup } from "@opentui/keymap/extras"
import { TuiKeybind } from "../../../../src/cli/cmd/tui/config/keybind"
import * as AppExit from "../../../../src/kilocode/tui/app-exit"

const prompt = (focused: boolean, input: string): AppExit.Prompt => ({
  focused,
  current: { input },
})

describe("app_exit", () => {
  test("blocks exit when the command matcher is disabled", () => {
    const bindings = createBindingLookup(TuiKeybind.toBindingConfig(TuiKeybind.parse({})), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }).gather("app_exit", ["app.exit"])

    expect(bindings.length).toBeGreaterThan(0)
    expect(AppExit.enabled(false)).toBe(false)
  })

  test("permits exit without a prompt ref", () => {
    expect(AppExit.enabled(true)).toBe(true)
  })

  test("blocks focused prompts with non-empty input including whitespace", () => {
    expect(AppExit.enabled(true, prompt(true, "keep typing"))).toBe(false)
    expect(AppExit.enabled(true, prompt(true, "   "))).toBe(false)
  })

  test("permits focused empty and unfocused prompts", () => {
    expect(AppExit.enabled(true, prompt(true, ""))).toBe(true)
    expect(AppExit.enabled(true, prompt(false, "keep typing"))).toBe(true)
  })

  test("registers slash exit independently of binding enablement", () => {
    let exited = false
    const command = AppExit.command(() => {
      exited = true
    })

    expect(command).toMatchObject({
      name: "app.exit",
      slashName: "exit",
      slashAliases: ["quit", "q"],
    })
    command.run()
    expect(exited).toBe(true)
  })
})
