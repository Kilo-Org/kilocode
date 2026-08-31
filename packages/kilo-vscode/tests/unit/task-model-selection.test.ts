import { describe, expect, it } from "bun:test"
import { ConfigState } from "../../webview-ui/src/utils/config-utils"

describe("task subagent model selection config", () => {
  it("stages the experimental toggle and discards it", () => {
    const state = new ConfigState()
    state.handleConfigLoaded({ experimental: { task_model_selection: false } })

    state.updateConfig({ experimental: { task_model_selection: true } })

    expect(state.config.experimental?.task_model_selection).toBe(true)
    expect(state.draft.experimental?.task_model_selection).toBe(true)
    expect(state.dirty).toBe(true)

    state.discardConfig()

    expect(state.config.experimental?.task_model_selection).toBe(false)
    expect(state.dirty).toBe(false)
  })

  it("clears the draft after the backend confirms the save", () => {
    const state = new ConfigState()
    state.handleConfigLoaded({ experimental: { task_model_selection: false } })
    state.updateConfig({ experimental: { task_model_selection: true } })
    state.saveConfig()

    expect(state.saving).toBe(true)

    state.handleConfigUpdated({ experimental: { task_model_selection: true } })

    expect(state.config.experimental?.task_model_selection).toBe(true)
    expect(state.dirty).toBe(false)
    expect(state.saving).toBe(false)
    expect(state.draft).toEqual({})
  })
})
