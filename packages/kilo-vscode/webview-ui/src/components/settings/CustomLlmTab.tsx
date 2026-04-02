import { Component, createSignal, onMount, For, Show, createEffect } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { showToast } from "@kilocode/kilo-ui/toast"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { useVSCode } from "../../context/vscode"
import type { CustomLlmInfo, ExtensionMessage } from "../../types/messages"

const CustomLlmTab: Component = () => {
  const vscode = useVSCode()
  const [items, setItems] = createSignal<CustomLlmInfo[]>([])
  const [loading, setLoading] = createSignal(true)
  const [editing, setEditing] = createSignal<CustomLlmInfo | null>(null)
  const [creating, setCreating] = createSignal(false)
  const [name, setName] = createSignal("")
  const [config, setConfig] = createSignal("")
  const [nameError, setNameError] = createSignal("")
  const [configError, setConfigError] = createSignal("")
  const [saving, setSaving] = createSignal(false)

  onMount(() => {
    vscode.postMessage({ type: "requestCustomLlmList" })
  })

  createEffect(() => {
    const handler = (event: MessageEvent<ExtensionMessage>) => {
      const msg = event.data
      switch (msg.type) {
        case "customLlmListLoaded":
          setItems(msg.items)
          setLoading(false)
          break
        case "customLlmSaved":
          setSaving(false)
          showToast({ variant: "success", title: `Model ${msg.action}` })
          resetForm()
          break
        case "customLlmDeleted":
          showToast({ variant: "success", title: "Model deleted" })
          break
        case "customLlmError":
          setSaving(false)
          showToast({ variant: "error", title: "Error", description: msg.message })
          break
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  })

  function resetForm() {
    setEditing(null)
    setCreating(false)
    setName("")
    setConfig("")
    setNameError("")
    setConfigError("")
  }

  function startCreate() {
    resetForm()
    setCreating(true)
    setConfig("{\n  \n}")
  }

  function startEdit(item: CustomLlmInfo) {
    resetForm()
    setEditing(item)
    setName(item.name)
    // Pretty-print JSON for editing
    try {
      setConfig(JSON.stringify(JSON.parse(item.config), null, 2))
    } catch {
      setConfig(item.config)
    }
  }

  function validate(): boolean {
    let valid = true
    setNameError("")
    setConfigError("")

    if (!name().trim()) {
      setNameError("Name is required")
      valid = false
    }

    const raw = config().trim()
    if (!raw) {
      setConfigError("Config JSON is required")
      valid = false
    } else {
      try {
        const parsed = JSON.parse(raw)
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          setConfigError("Config must be a JSON object")
          valid = false
        }
      } catch {
        setConfigError("Invalid JSON syntax")
        valid = false
      }
    }
    return valid
  }

  function handleSave() {
    if (!validate()) return
    setSaving(true)
    const current = editing()
    vscode.postMessage({
      type: "saveCustomLlm",
      ...(current ? { id: current.id } : {}),
      name: name().trim(),
      config: config().trim(),
    })
  }

  function handleDelete(id: string) {
    vscode.postMessage({ type: "deleteCustomLlm", id })
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleString()
  }

  const showForm = () => creating() || editing() !== null

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      <Show when={!showForm()}>
        <div style={{ display: "flex", "justify-content": "flex-end" }}>
          <Button variant="primary" size="small" onClick={startCreate}>
            Add Model
          </Button>
        </div>

        <Show when={loading()}>
          <div style={{ display: "flex", "justify-content": "center", padding: "24px" }}>
            <Spinner />
          </div>
        </Show>

        <Show when={!loading() && items().length === 0}>
          <p style={{ color: "var(--foreground-3)", "text-align": "center", padding: "24px" }}>
            No custom LLM models defined yet. Click "Add Model" to create one.
          </p>
        </Show>

        <Show when={!loading() && items().length > 0}>
          <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
            <For each={items()}>
              {(item) => (
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "12px",
                    padding: "12px",
                    "border-radius": "6px",
                    border: "1px solid var(--border-weak-base)",
                    background: "var(--background-2)",
                  }}
                >
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <div style={{ "font-weight": "600", "margin-bottom": "4px" }}>{item.name}</div>
                    <div style={{ "font-size": "12px", color: "var(--foreground-3)" }}>
                      ID: {item.id} | Updated: {formatDate(item.time_updated)}
                    </div>
                  </div>
                  <IconButton
                    icon="edit"
                    variant="ghost"
                    size="small"
                    onClick={() => startEdit(item)}
                    aria-label="Edit"
                  />
                  <IconButton
                    icon="trash"
                    variant="ghost"
                    size="small"
                    onClick={() => handleDelete(item.id)}
                    aria-label="Delete"
                  />
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <Show when={showForm()}>
        <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
          <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "4px" }}>
            <Button variant="ghost" size="small" onClick={resetForm}>
              Back
            </Button>
            <span style={{ "font-weight": "600" }}>{editing() ? `Edit: ${editing()!.name}` : "New Custom LLM"}</span>
          </div>

          <TextField
            label="Name"
            value={name()}
            onChange={setName}
            error={nameError()}
            validationState={nameError() ? "invalid" : "valid"}
            placeholder="e.g. My Custom GPT"
          />

          <div data-component="input" data-variant="normal">
            <label data-slot="input-label">Config (JSON)</label>
            <div data-slot="input-wrapper">
              <textarea
                data-slot="input-input"
                value={config()}
                onInput={(e) => setConfig(e.currentTarget.value)}
                placeholder='{ "key": "value" }'
                rows={15}
                spellcheck={false}
                style={{
                  "font-family": "var(--font-mono, monospace)",
                  "font-size": "13px",
                  "line-height": "1.5",
                  resize: "vertical",
                  "tab-size": "2",
                  "white-space": "pre",
                  width: "100%",
                }}
              />
            </div>
            <Show when={configError()}>
              <div
                data-slot="input-error"
                style={{ color: "var(--status-error)", "font-size": "12px", "margin-top": "4px" }}
              >
                {configError()}
              </div>
            </Show>
          </div>

          <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end" }}>
            <Button variant="ghost" size="small" onClick={resetForm}>
              Cancel
            </Button>
            <Button variant="primary" size="small" onClick={handleSave} disabled={saving()}>
              {saving() ? "Saving..." : editing() ? "Update" : "Create"}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}

export default CustomLlmTab
