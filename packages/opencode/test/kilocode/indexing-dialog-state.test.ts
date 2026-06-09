import { describe, expect, test } from "bun:test"
import { createEffect, createRoot, createSignal } from "solid-js"
import type { IndexingConfig } from "@kilocode/sdk/v2"
import { createIndexingDialogState, type IndexingScope } from "../../src/kilocode/components/indexing-dialog-state"

describe("indexing dialog state", () => {
  test("reacts when the project overlay loads", () => {
    const [scope, setScope] = createSignal<IndexingScope>("project")
    const [global, setGlobal] = createSignal<IndexingConfig>({ enabled: true, provider: "openai" })
    const [project, setProject] = createSignal<IndexingConfig>({})
    const seen: IndexingConfig[] = []

    const dispose = createRoot((dispose) => {
      const state = createIndexingDialogState({ scope, global, project, resolve: (config) => config })
      createEffect(() => seen.push(state.config()))
      return dispose
    })

    setProject({ enabled: false, provider: "ollama" })
    setScope("global")
    setGlobal({ enabled: false, provider: "gemini" })

    expect(seen).toEqual([
      {},
      { enabled: false, provider: "ollama" },
      { enabled: true, provider: "openai" },
      { enabled: false, provider: "gemini" },
    ])
    dispose()
  })

  test("resolves selected-scope enablement and inheritance", () => {
    const [scope, setScope] = createSignal<IndexingScope>("project")
    const [global] = createSignal<IndexingConfig>({ enabled: true })
    const [project, setProject] = createSignal<IndexingConfig>({})

    const result = createRoot((dispose) => {
      const state = createIndexingDialogState({ scope, global, project, resolve: (config) => config })
      return { state, dispose }
    })

    expect(result.state.enabled()).toBe(true)
    expect(result.state.inherited()).toBe(true)

    setProject({ enabled: false })
    expect(result.state.enabled()).toBe(false)
    expect(result.state.inherited()).toBe(false)

    setScope("global")
    expect(result.state.enabled()).toBe(true)
    expect(result.state.inherited()).toBe(false)
    result.dispose()
  })
})
