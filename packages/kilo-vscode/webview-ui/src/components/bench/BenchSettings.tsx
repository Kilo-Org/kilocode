import { createSignal, createEffect, onCleanup, For, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useVSCode } from "../../context/vscode"
import type { BenchConfig } from "../../types/messages"

const ALL_MODES = ["architect", "code", "debug", "ask", "orchestrator"]

const MODE_LABELS: Record<string, string> = {
  architect: "Architect",
  code: "Code",
  debug: "Debug",
  ask: "Ask",
  orchestrator: "Orchestrator",
}

interface BenchSettingsProps {
  onClose: () => void
}

export function BenchSettings(props: BenchSettingsProps) {
  const vscode = useVSCode()
  const [config, setConfig] = createSignal<BenchConfig | null>(null)

  const unsub = vscode.onMessage((message: any) => {
    if (message.type === "benchConfig" && message.benchConfig) {
      setConfig(message.benchConfig)
    }
  })

  onCleanup(() => unsub())

  // Load config on mount
  vscode.postMessage({ type: "benchLoadResults" } as any)

  const updateConfig = (updates: Partial<BenchConfig>) => {
    const current = config()
    if (!current) return
    const newConfig = { ...current, ...updates }
    if (updates.weights) {
      newConfig.weights = { ...current.weights, ...updates.weights }
    }
    setConfig(newConfig)
    vscode.postMessage({ type: "benchUpdateConfig", benchConfig: updates } as any)
  }

  const toggleMode = (mode: string) => {
    const current = config()
    if (!current) return
    const modes = current.activeModes.includes(mode)
      ? current.activeModes.filter((m) => m !== mode)
      : [...current.activeModes, mode]
    updateConfig({ activeModes: modes })
  }

  const rangeStyle = {
    width: "100%",
    "accent-color": "var(--vscode-focusBorder)",
  }

  return (
    <Show
      when={config()}
      fallback={
        <div style={{ display: "flex", "align-items": "center", "justify-content": "center", height: "100%", "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
          Loading settings...
        </div>
      }
    >
      {(cfg) => (
        <div style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
          <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <Icon name="settings-gear" />
              <h4 style={{ "font-size": "14px", "font-weight": "500", margin: 0, color: "var(--vscode-foreground)" }}>
                Bench Settings
              </h4>
            </div>
            <Button variant="ghost" size="small" onClick={() => props.onClose()}>
              Done
            </Button>
          </div>

          {/* Problems per mode */}
          <div>
            <label style={{ "font-size": "12px", "font-weight": "500", color: "var(--vscode-foreground)", display: "block", "margin-bottom": "8px" }}>
              Problems per Mode: {cfg().problemsPerMode}
            </label>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={cfg().problemsPerMode}
              onInput={(e) => updateConfig({ problemsPerMode: parseInt(e.currentTarget.value) })}
              style={rangeStyle}
            />
          </div>

          {/* Active modes */}
          <div>
            <label style={{ "font-size": "12px", "font-weight": "500", color: "var(--vscode-foreground)", display: "block", "margin-bottom": "8px" }}>
              Active Modes
            </label>
            <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
              <For each={ALL_MODES}>
                {(mode) => (
                  <Checkbox
                    checked={cfg().activeModes.includes(mode)}
                    onChange={() => toggleMode(mode)}
                  >
                    {MODE_LABELS[mode]}
                  </Checkbox>
                )}
              </For>
            </div>
          </div>

          {/* Scoring weights */}
          <div>
            <label style={{ "font-size": "12px", "font-weight": "500", color: "var(--vscode-foreground)", display: "block", "margin-bottom": "8px" }}>
              Scoring Weights
            </label>
            <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
              <For each={["quality", "relevance", "speed", "cost"] as const}>
                {(key) => (
                  <div>
                    <div
                      style={{
                        display: "flex",
                        "justify-content": "space-between",
                        "font-size": "10px",
                        color: "var(--vscode-descriptionForeground)",
                        "margin-bottom": "2px",
                      }}
                    >
                      <span style={{ "text-transform": "capitalize" }}>{key}</span>
                      <span>{(cfg().weights[key] * 100).toFixed(0)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={cfg().weights[key] * 100}
                      onInput={(e) =>
                        updateConfig({
                          weights: { ...cfg().weights, [key]: parseInt(e.currentTarget.value) / 100 },
                        })
                      }
                      style={rangeStyle}
                    />
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}
