import { createSignal, createMemo, createEffect, For, Show } from "solid-js"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useProvider, type EnrichedModel } from "../../context/provider"
import { KILO_GATEWAY_ID, isFree } from "../chat/model-selector-utils"

interface SelectedModel {
  modelId: string
  modelName: string
}

interface BenchModelSelectorProps {
  onRunBenchmark: (selectedModels: string[]) => void
  onCancel: () => void
}

export function BenchModelSelector(props: BenchModelSelectorProps) {
  const { models } = useProvider()
  const [selectedModels, setSelectedModels] = createSignal<SelectedModel[]>([])

  // Model popover state
  const [modelOpen, setModelOpen] = createSignal(false)
  const [modelSearch, setModelSearch] = createSignal("")
  const [modelActiveIdx, setModelActiveIdx] = createSignal(0)
  let modelSearchRef: HTMLInputElement | undefined
  let modelListRef: HTMLDivElement | undefined

  // Only Kilo Gateway models
  const kiloModels = createMemo(() =>
    models().filter((m) => m.providerID === KILO_GATEWAY_ID),
  )

  const hasKiloGateway = createMemo(() => kiloModels().length > 0)

  // Available models (exclude already selected)
  const availableModels = createMemo<EnrichedModel[]>(() => {
    const sel = new Set(selectedModels().map((m) => m.modelId))
    return kiloModels().filter((m) => !sel.has(m.id))
  })

  const filteredModels = createMemo(() => {
    const q = modelSearch().toLowerCase()
    if (!q) return availableModels()
    return availableModels().filter(
      (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    )
  })

  // Reset index on filter change
  createEffect(() => { filteredModels(); setModelActiveIdx(0) })

  // Focus search on open
  createEffect(() => {
    if (modelOpen()) {
      requestAnimationFrame(() => modelSearchRef?.focus())
    } else {
      setModelSearch("")
    }
  })

  function addModel(model: EnrichedModel) {
    setSelectedModels((prev) => [
      ...prev,
      { modelId: model.id, modelName: model.name || model.id },
    ])
    setModelOpen(false)
  }

  function removeModel(modelId: string) {
    setSelectedModels((prev) => prev.filter((m) => m.modelId !== modelId))
  }

  function handleKeyDown(e: KeyboardEvent) {
    const items = filteredModels()
    if (e.key === "Escape") { e.preventDefault(); setModelOpen(false); return }
    if (items.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setModelActiveIdx((i) => (i + 1) % items.length)
      requestAnimationFrame(() => modelListRef?.querySelector(".model-selector-item.active")?.scrollIntoView({ block: "nearest" }))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setModelActiveIdx((i) => (i - 1 + items.length) % items.length)
      requestAnimationFrame(() => modelListRef?.querySelector(".model-selector-item.active")?.scrollIntoView({ block: "nearest" }))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const item = items[modelActiveIdx()]
      if (item) addModel(item)
    }
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", gap: "16px" }}>
      {/* Header */}
      <div>
        <h4 style={{ "font-size": "13px", "font-weight": "500", margin: "0 0 4px 0", color: "var(--vscode-foreground)" }}>
          Select Models to Benchmark
        </h4>
        <p style={{ "font-size": "12px", color: "var(--text-weak, var(--vscode-descriptionForeground))", margin: 0 }}>
          Choose models from Kilo Gateway to test against your codebase.
        </p>
      </div>

      <Show
        when={hasKiloGateway()}
        fallback={
          <div style={{
            flex: 1, display: "flex", "flex-direction": "column", "align-items": "center",
            "justify-content": "center", gap: "12px", padding: "32px 16px", "text-align": "center",
          }}>
            <Icon name="circle-x" />
            <div>
              <div style={{ "font-size": "13px", "font-weight": "500", color: "var(--vscode-foreground)", "margin-bottom": "4px" }}>
                Kilo Gateway Required
              </div>
              <div style={{ "font-size": "12px", color: "var(--text-weak, var(--vscode-descriptionForeground))", "max-width": "280px" }}>
                Bench uses Kilo Gateway to run benchmarks across models. Please set up Kilo Gateway in your provider settings to continue.
              </div>
            </div>
            <Button variant="secondary" size="small" onClick={() => props.onCancel()}>
              Back
            </Button>
          </div>
        }
      >
        {/* Model picker */}
        <div>
          <Popover
            placement="bottom-start"
            open={modelOpen()}
            onOpenChange={setModelOpen}
            triggerAs={Button}
            triggerProps={{ variant: "secondary", size: "small" }}
            trigger={
              <>
                <span class="model-selector-trigger-label">Add model...</span>
                <svg class="model-selector-trigger-chevron" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 6l4 5 4-5H4z" />
                </svg>
              </>
            }
            class="model-selector-popover"
          >
            <div onKeyDown={handleKeyDown}>
              <div class="model-selector-search-wrapper">
                <input
                  ref={modelSearchRef}
                  class="model-selector-search"
                  type="text"
                  placeholder="Search models..."
                  value={modelSearch()}
                  onInput={(e) => setModelSearch(e.currentTarget.value)}
                />
              </div>
              <div class="model-selector-list" role="listbox" ref={modelListRef}>
                <Show when={filteredModels().length === 0}>
                  <div class="model-selector-empty">
                    {modelSearch() ? "No matching models" : "All available models selected"}
                  </div>
                </Show>
                <For each={filteredModels()}>
                  {(model, idx) => (
                    <div
                      class={`model-selector-item${idx() === modelActiveIdx() ? " active" : ""}`}
                      role="option"
                      onClick={() => addModel(model)}
                      onMouseEnter={() => setModelActiveIdx(idx())}
                    >
                      <span class="model-selector-item-name">{model.name || model.id}</span>
                      <Show when={isFree(model)}>
                        <span class="model-selector-tag">free</span>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Popover>
        </div>

        {/* Selected models chips */}
        <div style={{ flex: 1, "overflow-y": "auto" }}>
          <div style={{
            "font-size": "10px", "font-weight": "600",
            color: "var(--text-weak, var(--vscode-descriptionForeground))",
            "text-transform": "uppercase", "letter-spacing": "0.05em", "margin-bottom": "8px",
          }}>
            Selected ({selectedModels().length})
          </div>
          <Show
            when={selectedModels().length > 0}
            fallback={
              <div style={{
                padding: "24px 16px", "text-align": "center", "font-size": "12px",
                color: "var(--text-weak, var(--vscode-descriptionForeground))",
                border: "1px dashed var(--border-base, var(--vscode-panel-border))", "border-radius": "4px",
              }}>
                No models selected. Click "Add model" to get started.
              </div>
            }
          >
            <div style={{ display: "flex", "flex-wrap": "wrap", gap: "6px" }}>
              <For each={selectedModels()}>
                {(model) => (
                  <div
                    style={{
                      display: "inline-flex", "align-items": "center", gap: "4px",
                      padding: "3px 4px 3px 8px", "font-size": "12px", "border-radius": "4px",
                      background: "var(--surface-interactive-hover, var(--vscode-badge-background))",
                      color: "var(--vscode-foreground)",
                    }}
                    title={model.modelName}
                  >
                    <span style={{
                      overflow: "hidden", "text-overflow": "ellipsis",
                      "white-space": "nowrap", "max-width": "180px",
                    }}>
                      {model.modelName}
                    </span>
                    <button
                      onClick={() => removeModel(model.modelId)}
                      style={{
                        display: "inline-flex", "align-items": "center", "justify-content": "center",
                        border: "none", background: "none", cursor: "pointer", padding: "2px",
                        color: "var(--vscode-foreground)", opacity: "0.6", "border-radius": "2px", "line-height": "1",
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z" />
                      </svg>
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
          <span style={{ "font-size": "12px", color: "var(--text-weak, var(--vscode-descriptionForeground))" }}>
            {selectedModels().length} model{selectedModels().length !== 1 ? "s" : ""} selected
          </span>
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <Button variant="ghost" size="small" onClick={() => props.onCancel()}>
              Cancel
            </Button>
            <Button
              onClick={() => props.onRunBenchmark(selectedModels().map((m) => m.modelId))}
              disabled={selectedModels().length === 0}
            >
              <Icon name="chevron-right" />
              Generate & Run
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}
