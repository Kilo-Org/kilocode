import { Component, createSignal, createEffect, For, Show, onCleanup, onMount } from "solid-js"
import { useVSCode } from "../../context/vscode"

// ─── Types ───────────────────────────────────────────────

interface DiscoveryResult {
  timestamp: number
  providers: {
    ollama: { available: boolean; models: string[]; version?: string }
    lmstudio: { available: boolean; models: string[]; apiBase: string }
  }
  gpu: {
    detected: boolean
    name: string
    vramGb: number
    cudaVersion?: string
    driverVersion?: string
  }
  sshProfiles: Array<{
    name: string
    host: string
    port: number
    user: string
  }>
  speech: {
    browserVoicesAvailable: boolean
    voiceCount: number
  }
  hardware: {
    cpuModel: string
    cpuCores: number
    ramGb: number
    platform: string
    arch: string
  }
  hermes?: { configFound: boolean; endpoint?: string; reachable?: boolean }
  shiba?: { configFound: boolean; endpoint?: string; reachable?: boolean }
  zeroClaw?: { configFound: boolean; endpoint?: string; reachable?: boolean }
}

type Step = "discovery" | "review" | "secrets" | "validation" | "complete"

// ─── Component ────────────────────────────────────────────

const OnboardingWizard: Component<{ onFinish?: () => void }> = (props) => {
  const vscode = useVSCode()

  const [step, setStep] = createSignal<Step>("discovery")
  const [discovering, setDiscovering] = createSignal(true)
  const [result, setResult] = createSignal<DiscoveryResult | null>(null)
  const [discoveryError, setDiscoveryError] = createSignal<string | null>(null)

  // Provider selection — which to enable
  const [enableOllama, setEnableOllama] = createSignal(true)
  const [enableLMStudio, setEnableLMStudio] = createSignal(true)
  const [enableClaude, setEnableClaude] = createSignal(false)
  const [enableMiniMax, setEnableMiniMax] = createSignal(false)
  const [enableSiliconFlow, setEnableSiliconFlow] = createSignal(false)

  // Secret inputs
  const [claudeKey, setClaudeKey] = createSignal("")
  const [minimaxKey, setMinimaxKey] = createSignal("")
  const [siliconflowKey, setSiliconflowKey] = createSignal("")
  const [azureKey, setAzureKey] = createSignal("")

  // SSH import choice
  const [importSSH, setImportSSH] = createSignal(true)

  // Validation results per provider
  const [validating, setValidating] = createSignal(false)
  const [validationResults, setValidationResults] = createSignal<Record<string, { success: boolean; error?: string }>>({})

  // ─── Message handling ───────────────────────────────────

  const handleMessage = (event: MessageEvent) => {
    const msg = event.data as { type: string; [k: string]: unknown }
    switch (msg.type) {
      case "discoveryComplete": {
        const r = msg.result as DiscoveryResult
        setResult(r)
        setDiscovering(false)
        setStep("review")
        break
      }
      case "discoveryError": {
        const err = msg.error as string
        setDiscoveryError(err)
        setDiscovering(false)
        break
      }
      case "routingTestResult": {
        const pid = msg.providerId as string
        const success = msg.success as boolean
        setValidationResults((prev) => ({ ...prev, [pid]: { success } }))
        break
      }
    }
  }

  onMount(() => {
    window.addEventListener("message", handleMessage)
    // Trigger discovery
    vscode.postMessage({ type: "triggerDiscovery" })
  })

  onCleanup(() => {
    window.removeEventListener("message", handleMessage)
  })

  // ─── Actions ───────────────────────────────────────────

  const retryDiscovery = () => {
    setDiscovering(true)
    setDiscoveryError(null)
    vscode.postMessage({ type: "triggerDiscovery" })
  }

  const goToSecrets = () => {
    // Skip secrets step if no cloud providers are enabled
    const needsSecrets = enableClaude() || enableMiniMax() || enableSiliconFlow()
    setStep(needsSecrets ? "secrets" : "validation")
    if (!needsSecrets) runValidation()
  }

  const saveSecretsAndValidate = () => {
    if (enableClaude() && claudeKey().trim()) {
      vscode.postMessage({
        type: "routingConfigureKey",
        providerId: "claude",
        apiKey: claudeKey().trim(),
      })
    }
    if (enableMiniMax() && minimaxKey().trim()) {
      vscode.postMessage({
        type: "routingConfigureKey",
        providerId: "minimax",
        apiKey: minimaxKey().trim(),
      })
    }
    if (enableSiliconFlow() && siliconflowKey().trim()) {
      vscode.postMessage({
        type: "routingConfigureKey",
        providerId: "siliconflow",
        apiKey: siliconflowKey().trim(),
      })
    }
    setStep("validation")
    runValidation()
  }

  const runValidation = () => {
    setValidating(true)
    // Test each enabled provider
    const toTest: string[] = []
    if (enableOllama() && result()?.providers.ollama.available) toTest.push("ollama")
    if (enableLMStudio() && result()?.providers.lmstudio.available) toTest.push("lmstudio")
    if (enableClaude() && claudeKey().trim()) toTest.push("claude")
    if (enableMiniMax() && minimaxKey().trim()) toTest.push("minimax")
    if (enableSiliconFlow() && siliconflowKey().trim()) toTest.push("siliconflow")

    for (const pid of toTest) {
      vscode.postMessage({ type: "routingTestProvider", providerId: pid })
    }

    // After 15 seconds regardless, advance to complete
    setTimeout(() => {
      setValidating(false)
      setStep("complete")
    }, 15000)
  }

  const finish = () => {
    vscode.postMessage({ type: "markOnboardingComplete" })
    props.onFinish?.()
  }

  // ─── Render ─────────────────────────────────────────────

  return (
    <div style={{ padding: "24px", "max-width": "800px", margin: "0 auto" }}>
      {/* Progress bar */}
      <div style={{ display: "flex", "justify-content": "space-between", "margin-bottom": "24px" }}>
        <For each={["discovery", "review", "secrets", "validation", "complete"] as Step[]}>
          {(s) => (
            <div
              style={{
                flex: "1",
                padding: "8px",
                "text-align": "center",
                "border-bottom": step() === s ? "2px solid var(--vscode-focusBorder)" : "2px solid var(--vscode-panel-border)",
                color: step() === s ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
                "text-transform": "capitalize",
                "font-size": "13px",
              }}
            >
              {s}
            </div>
          )}
        </For>
      </div>

      {/* Step 1: Discovery */}
      <Show when={step() === "discovery"}>
        <h2>Welcome to KiloCode</h2>
        <p>Scanning your system to auto-populate tabs with real data…</p>
        <Show when={discovering()}>
          <div style={{ padding: "32px", "text-align": "center" }}>
            <div style={{ "font-size": "14px" }}>🔍 Discovering local providers, GPU, SSH config…</div>
          </div>
        </Show>
        <Show when={discoveryError()}>
          <div style={{ color: "var(--vscode-errorForeground)", padding: "16px" }}>
            Discovery failed: {discoveryError()}
            <button onClick={retryDiscovery} style={{ "margin-left": "12px" }}>Retry</button>
          </div>
        </Show>
      </Show>

      {/* Step 2: Review */}
      <Show when={step() === "review" && result()}>
        <h2>Here's what we found automatically</h2>
        <p style={{ color: "var(--vscode-descriptionForeground)" }}>
          Review the detected items below. You can enable or disable each one.
        </p>

        <div style={{ "margin-top": "16px" }}>
          <h3>Local Providers</h3>
          <label style={{ display: "flex", "align-items": "center", padding: "8px", gap: "8px" }}>
            <input type="checkbox" checked={enableOllama()} onChange={(e) => setEnableOllama(e.currentTarget.checked)} />
            <span>
              Ollama:{" "}
              <strong style={{ color: result()!.providers.ollama.available ? "var(--vscode-testing-iconPassed)" : "var(--vscode-testing-iconFailed)" }}>
                {result()!.providers.ollama.available ? `Found (${result()!.providers.ollama.models.length} models)` : "Not running"}
              </strong>
            </span>
          </label>
          <label style={{ display: "flex", "align-items": "center", padding: "8px", gap: "8px" }}>
            <input type="checkbox" checked={enableLMStudio()} onChange={(e) => setEnableLMStudio(e.currentTarget.checked)} />
            <span>
              LM Studio:{" "}
              <strong style={{ color: result()!.providers.lmstudio.available ? "var(--vscode-testing-iconPassed)" : "var(--vscode-testing-iconFailed)" }}>
                {result()!.providers.lmstudio.available ? `Found (${result()!.providers.lmstudio.models.length} models)` : "Not running"}
              </strong>
            </span>
          </label>
        </div>

        <div style={{ "margin-top": "16px" }}>
          <h3>Cloud Providers (require API keys)</h3>
          <label style={{ display: "flex", "align-items": "center", padding: "8px", gap: "8px" }}>
            <input type="checkbox" checked={enableClaude()} onChange={(e) => setEnableClaude(e.currentTarget.checked)} />
            <span>Claude (Anthropic)</span>
          </label>
          <label style={{ display: "flex", "align-items": "center", padding: "8px", gap: "8px" }}>
            <input type="checkbox" checked={enableMiniMax()} onChange={(e) => setEnableMiniMax(e.currentTarget.checked)} />
            <span>MiniMax</span>
          </label>
          <label style={{ display: "flex", "align-items": "center", padding: "8px", gap: "8px" }}>
            <input type="checkbox" checked={enableSiliconFlow()} onChange={(e) => setEnableSiliconFlow(e.currentTarget.checked)} />
            <span>SiliconFlow</span>
          </label>
        </div>

        <div style={{ "margin-top": "16px" }}>
          <h3>Hardware</h3>
          <div style={{ padding: "8px" }}>
            <div>CPU: {result()!.hardware.cpuModel} ({result()!.hardware.cpuCores} cores)</div>
            <div>RAM: {result()!.hardware.ramGb} GB</div>
            <div>
              GPU:{" "}
              {result()!.gpu.detected ? (
                <span style={{ color: "var(--vscode-testing-iconPassed)" }}>
                  {result()!.gpu.name} ({result()!.gpu.vramGb} GB VRAM)
                </span>
              ) : (
                <span style={{ color: "var(--vscode-descriptionForeground)" }}>Not detected</span>
              )}
            </div>
          </div>
        </div>

        <Show when={result()!.sshProfiles.length > 0}>
          <div style={{ "margin-top": "16px" }}>
            <h3>SSH Config</h3>
            <label style={{ display: "flex", "align-items": "center", padding: "8px", gap: "8px" }}>
              <input type="checkbox" checked={importSSH()} onChange={(e) => setImportSSH(e.currentTarget.checked)} />
              <span>Import {result()!.sshProfiles.length} hosts from ~/.ssh/config</span>
            </label>
            <ul style={{ "margin-left": "32px", color: "var(--vscode-descriptionForeground)" }}>
              <For each={result()!.sshProfiles.slice(0, 5)}>
                {(profile) => (
                  <li style={{ "font-size": "12px" }}>
                    {profile.name} → {profile.user}@{profile.host}:{profile.port}
                  </li>
                )}
              </For>
              <Show when={result()!.sshProfiles.length > 5}>
                <li style={{ "font-size": "12px" }}>… and {result()!.sshProfiles.length - 5} more</li>
              </Show>
            </ul>
          </div>
        </Show>

        <Show when={result()!.hermes?.configFound || result()!.shiba?.configFound}>
          <div style={{ "margin-top": "16px" }}>
            <h3>Memory Services</h3>
            <Show when={result()!.hermes?.configFound}>
              <div style={{ padding: "8px" }}>
                Hermes: <strong>{result()!.hermes!.endpoint} {result()!.hermes!.reachable ? "✓" : "⚠"}</strong>
              </div>
            </Show>
            <Show when={result()!.shiba?.configFound}>
              <div style={{ padding: "8px" }}>
                Shiba: <strong>{result()!.shiba!.endpoint} {result()!.shiba!.reachable ? "✓" : "⚠"}</strong>
              </div>
            </Show>
          </div>
        </Show>

        <div style={{ "margin-top": "24px", display: "flex", "justify-content": "flex-end", gap: "12px" }}>
          <button onClick={finish}>Skip Wizard</button>
          <button onClick={goToSecrets} style={{ "font-weight": "bold" }}>Continue →</button>
        </div>
      </Show>

      {/* Step 3: Secrets */}
      <Show when={step() === "secrets"}>
        <h2>API Keys</h2>
        <p style={{ color: "var(--vscode-descriptionForeground)" }}>
          Keys are stored securely in VS Code's encrypted SecretStorage.
        </p>

        <Show when={enableClaude()}>
          <div style={{ padding: "12px 0" }}>
            <label style={{ display: "block", "margin-bottom": "4px" }}>Claude API Key</label>
            <input
              type="password"
              value={claudeKey()}
              onInput={(e) => setClaudeKey(e.currentTarget.value)}
              placeholder="sk-ant-..."
              style={{ width: "100%", padding: "8px" }}
            />
          </div>
        </Show>
        <Show when={enableMiniMax()}>
          <div style={{ padding: "12px 0" }}>
            <label style={{ display: "block", "margin-bottom": "4px" }}>MiniMax API Key</label>
            <input
              type="password"
              value={minimaxKey()}
              onInput={(e) => setMinimaxKey(e.currentTarget.value)}
              placeholder="MiniMax key"
              style={{ width: "100%", padding: "8px" }}
            />
          </div>
        </Show>
        <Show when={enableSiliconFlow()}>
          <div style={{ padding: "12px 0" }}>
            <label style={{ display: "block", "margin-bottom": "4px" }}>SiliconFlow API Key</label>
            <input
              type="password"
              value={siliconflowKey()}
              onInput={(e) => setSiliconflowKey(e.currentTarget.value)}
              placeholder="sk-..."
              style={{ width: "100%", padding: "8px" }}
            />
          </div>
        </Show>

        <div style={{ "margin-top": "24px", display: "flex", "justify-content": "space-between" }}>
          <button onClick={() => setStep("review")}>← Back</button>
          <button onClick={saveSecretsAndValidate} style={{ "font-weight": "bold" }}>Save & Validate →</button>
        </div>
      </Show>

      {/* Step 4: Validation */}
      <Show when={step() === "validation"}>
        <h2>Testing connections…</h2>
        <p style={{ color: "var(--vscode-descriptionForeground)" }}>
          Verifying each enabled provider.
        </p>

        <div style={{ padding: "16px" }}>
          <For each={Object.entries(validationResults())}>
            {([provider, res]) => (
              <div style={{ padding: "8px" }}>
                {res.success ? "✅" : "❌"} {provider}: {res.success ? "Connected" : res.error ?? "Failed"}
              </div>
            )}
          </For>
          <Show when={validating()}>
            <div style={{ padding: "16px", "text-align": "center", color: "var(--vscode-descriptionForeground)" }}>
              Running tests…
            </div>
          </Show>
        </div>

        <div style={{ "margin-top": "24px", display: "flex", "justify-content": "flex-end" }}>
          <button onClick={() => setStep("complete")}>Skip to Finish →</button>
        </div>
      </Show>

      {/* Step 5: Complete */}
      <Show when={step() === "complete"}>
        <h2>Setup Complete! 🎉</h2>
        <p>
          KiloCode is ready. Your tabs are now populated with real data:
        </p>
        <ul>
          <li>Provider Routing — auto-detected local providers</li>
          <li>Training & GPU — hardware auto-detected</li>
          <li>SSH & Remote — config auto-imported</li>
          <li>Governance — defaults pre-seeded</li>
        </ul>
        <p style={{ color: "var(--vscode-descriptionForeground)", "font-size": "12px" }}>
          You can re-run this wizard anytime from the Command Palette: "KiloCode: Run Onboarding Wizard"
        </p>

        <div style={{ "margin-top": "24px", display: "flex", "justify-content": "flex-end" }}>
          <button onClick={finish} style={{ "font-weight": "bold" }}>Finish</button>
        </div>
      </Show>
    </div>
  )
}

export default OnboardingWizard
