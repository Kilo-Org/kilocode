import { createSignal, onMount, onCleanup, Switch, Match, Show } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useVSCode } from "../../context/vscode"
import { BenchEmptyState } from "./BenchEmptyState"
import { BenchModelSelector } from "./BenchModelSelector"
import { BenchProgressView } from "./BenchProgress"
import { BenchDashboard } from "./BenchDashboard"
import { BenchSettings } from "./BenchSettings"
import type { BenchProgress, BenchRunResult } from "../../types/messages"

type BenchSubView = "empty" | "modelSelect" | "running" | "results" | "settings"

interface CheckpointInfo {
  models: string[]
  phase: string
  progress: string
}

interface BenchViewProps {
  onDone: () => void
}

export default function BenchView(props: BenchViewProps) {
  const vscode = useVSCode()
  const [subView, setSubView] = createSignal<BenchSubView>("empty")
  const [progress, setProgress] = createSignal<BenchProgress | null>(null)
  const [results, setResults] = createSignal<BenchRunResult | null>(null)
  const [checkpoint, setCheckpoint] = createSignal<CheckpointInfo | null>(null)
  const [isCreditError, setIsCreditError] = createSignal(false)
  const [returnFromSettings, setReturnFromSettings] = createSignal<BenchSubView>("empty")

  onMount(() => {
    vscode.postMessage({ type: "benchLoadResults" } as any)
  })

  const unsub = vscode.onMessage((message: any) => {
    switch (message.type) {
      case "benchProgress":
        setProgress(message.benchProgress)
        break
      case "benchResults":
        setResults(message.benchResults)
        setSubView("results")
        setCheckpoint(null)
        break
      case "benchError":
        setIsCreditError(!!message.benchIsCreditError)
        setProgress({ phase: "error", message: message.benchError })
        if (subView() !== "running") {
          setSubView("running")
        }
        break
      case "benchCheckpoint":
        if (message.benchHasCheckpoint) {
          setCheckpoint({
            models: message.benchCheckpointModels || [],
            phase: message.benchCheckpointPhase || "running",
            progress: message.benchCheckpointProgress || "",
          })
        } else {
          setCheckpoint(null)
        }
        break
    }
  })

  onCleanup(() => unsub())

  const showSettingsGear = () => subView() === "empty" || subView() === "modelSelect"

  function handleResume() {
    setIsCreditError(false)
    setSubView("running")
    setProgress({ phase: "running", message: "Resuming benchmark..." })
    vscode.postMessage({ type: "benchResumeRun" } as any)
  }

  function handleDiscardCheckpoint() {
    vscode.postMessage({ type: "benchClearCheckpoint" } as any)
    setCheckpoint(null)
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          "border-bottom": "1px solid var(--border-weak-base)",
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
        }}
      >
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <Button variant="ghost" size="small" onClick={() => props.onDone()}>
            <Icon name="arrow-left" />
          </Button>
          <h3 style={{ "font-size": "14px", "font-weight": "600", margin: 0, color: "var(--vscode-foreground)" }}>
            Bench
          </h3>
        </div>
        <Show when={showSettingsGear()}>
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              setReturnFromSettings(subView())
              setSubView("settings")
            }}
          >
            <Icon name="settings-gear" />
          </Button>
        </Show>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
        <Switch>
          <Match when={subView() === "empty"}>
            <BenchEmptyState
              onStartBenchmark={() => setSubView("modelSelect")}
              checkpoint={checkpoint()}
              onResume={handleResume}
              onDiscardCheckpoint={handleDiscardCheckpoint}
            />
          </Match>
          <Match when={subView() === "modelSelect"}>
            <BenchModelSelector
              onRunBenchmark={(models) => {
                setIsCreditError(false)
                setSubView("running")
                vscode.postMessage({ type: "benchStartRun", benchModels: models } as any)
              }}
              onCancel={() => setSubView("empty")}
            />
          </Match>
          <Match when={subView() === "running"}>
            <BenchProgressView
              progress={progress() || { phase: "generating", message: "Starting benchmark..." }}
              isCreditError={isCreditError()}
              onCancel={() => {
                vscode.postMessage({ type: "benchCancelRun" } as any)
                setSubView("empty")
              }}
              onResume={handleResume}
            />
          </Match>
          <Match when={subView() === "results" && results()}>
            <BenchDashboard
              result={results()!}
              onNewBenchmark={() => {
                setResults(null)
                setSubView("modelSelect")
              }}
            />
          </Match>
          <Match when={subView() === "settings"}>
            <BenchSettings onClose={() => setSubView(returnFromSettings())} />
          </Match>
        </Switch>
      </div>
    </div>
  )
}
