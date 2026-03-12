import { Component, Show, For, createSignal, createMemo, createEffect, onCleanup } from "solid-js"
import { useVSCode } from "../../context/vscode"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import type { MarketplaceItem, McpInstallationMethod, McpParameter, McpMarketplaceItem } from "../../types/marketplace"
import type { ExtensionMessage } from "../../types/messages"

interface InstallModalProps {
  item: MarketplaceItem | null
  onClose: () => void
  onInstallResult?: (result: { success: boolean; slug: string; scope: "project" | "global"; error?: string }) => void
}

export const InstallModal: Component<InstallModalProps> = (props) => {
  const vscode = useVSCode()
  const server = useServer()
  const { t } = useLanguage()

  const [scope, setScope] = createSignal<"project" | "global">(server.workspaceDirectory() ? "project" : "global")
  const [selected, setSelected] = createSignal(0)
  const [params, setParams] = createSignal<Record<string, string>>({})
  const [errors, setErrors] = createSignal<Record<string, string>>({})
  const [installing, setInstalling] = createSignal(false)
  const [result, setResult] = createSignal<{ success: boolean; slug: string; error?: string } | null>(null)

  const workspace = createMemo(() => !!server.workspaceDirectory())

  // Reset state when item changes
  createEffect(() => {
    const item = props.item
    if (!item) return
    setScope(server.workspaceDirectory() ? "project" : "global")
    setSelected(0)
    setParams({})
    setErrors({})
    setInstalling(false)
    setResult(null)
  })

  // Listen for install result messages
  createEffect(() => {
    const item = props.item
    if (!item) return

    const unsubscribe = vscode.onMessage((msg: ExtensionMessage) => {
      if (msg.type !== "marketplaceInstallResult") return
      if (msg.slug !== item.id) return
      const r = { success: msg.success, slug: msg.slug, scope: scope(), error: msg.error }
      setResult(r)
      setInstalling(false)
      props.onInstallResult?.(r)
    })

    onCleanup(unsubscribe)
  })

  const methods = createMemo((): McpInstallationMethod[] => {
    const item = props.item
    if (!item || item.type !== "mcp") return []
    if (!Array.isArray(item.content)) return []
    return item.content
  })

  const prerequisites = createMemo((): string[] => {
    const item = props.item
    if (!item) return []
    const global = item.prerequisites ?? []
    if (item.type !== "mcp" || !Array.isArray(item.content)) return global
    const method = item.content[selected()]
    if (!method) return global
    const local = method.prerequisites ?? []
    return [...new Set([...global, ...local])]
  })

  const parameters = createMemo((): McpParameter[] => {
    const item = props.item
    if (!item) return []
    if (item.type !== "mcp") return []
    const mcp = item as McpMarketplaceItem
    if (!Array.isArray(mcp.content)) return mcp.parameters ?? []
    const global = mcp.parameters ?? []
    const method = mcp.content[selected()]
    if (!method) return global
    const local = method.parameters ?? []
    // Method-specific overrides global (dedup by key)
    const map = new Map<string, McpParameter>()
    for (const p of global) map.set(p.key, p)
    for (const p of local) map.set(p.key, p)
    return [...map.values()]
  })

  const handleInstall = () => {
    const item = props.item
    if (!item || installing()) return

    // Validate required parameters
    const validation: Record<string, string> = {}
    for (const p of parameters()) {
      if (p.optional) continue
      if (!(params()[p.key] ?? "").trim()) {
        validation[p.key] = t("marketplace.install.required", { name: p.name })
      }
    }
    setErrors(validation)
    if (Object.keys(validation).length > 0) return

    setInstalling(true)

    const options = {
      target: scope(),
      parameters: {
        ...params(),
        ...(item.type === "mcp" && Array.isArray(item.content) ? { _selectedIndex: selected() } : {}),
      },
    }

    vscode.postMessage({
      type: "installMarketplaceItem",
      mpItem: item,
      mpInstallOptions: options,
    })
  }

  return (
    <Show when={props.item}>
      <div class="install-modal-overlay" onClick={() => !installing() && props.onClose()}>
        <div class="install-modal" onClick={(e) => e.stopPropagation()}>
          <div class="install-modal-header">
            <h3>{t("marketplace.install.title", { name: props.item!.name })}</h3>
            <button class="install-modal-close" onClick={props.onClose} disabled={installing()}>
              ×
            </button>
          </div>

          <Show when={!result()}>
            <div class="install-modal-body">
              {/* Scope Selection */}
              <div class="install-modal-section">
                <label class="install-modal-label">{t("marketplace.install.scope")}</label>
                <div class="install-modal-radio-group">
                  <label>
                    <input
                      type="radio"
                      name="scope"
                      value="project"
                      checked={scope() === "project"}
                      disabled={!workspace()}
                      onChange={() => setScope("project")}
                    />
                    {t("marketplace.install.project")}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="scope"
                      value="global"
                      checked={scope() === "global"}
                      onChange={() => setScope("global")}
                    />
                    {t("marketplace.install.global")}
                  </label>
                </div>
              </div>

              {/* Installation Method (MCP with array content only) */}
              <Show when={props.item!.type === "mcp" && methods().length > 0}>
                <div class="install-modal-section">
                  <label class="install-modal-label">{t("marketplace.install.method")}</label>
                  <select value={selected()} onChange={(e) => setSelected(Number(e.target.value))}>
                    <For each={methods()}>{(method, i) => <option value={i()}>{method.name}</option>}</For>
                  </select>
                </div>
              </Show>

              {/* Prerequisites */}
              <Show when={prerequisites().length > 0}>
                <div class="install-modal-section">
                  <label class="install-modal-label">{t("marketplace.install.prerequisites")}</label>
                  <ul class="install-modal-prerequisites">
                    <For each={prerequisites()}>{(prereq) => <li>{prereq}</li>}</For>
                  </ul>
                </div>
              </Show>

              {/* Parameters */}
              <Show when={parameters().length > 0}>
                <div class="install-modal-section">
                  <label class="install-modal-label">{t("marketplace.install.parameters")}</label>
                  <For each={parameters()}>
                    {(param) => (
                      <div class="install-modal-param">
                        <label>
                          {param.name}
                          <Show when={param.optional}>
                            <span class="install-modal-optional"> {t("marketplace.install.optional")}</span>
                          </Show>
                        </label>
                        <input
                          type="text"
                          placeholder={param.placeholder ?? ""}
                          value={params()[param.key] ?? ""}
                          onInput={(e) => setParams((p) => ({ ...p, [param.key]: e.target.value }))}
                        />
                        <Show when={errors()[param.key]}>
                          <span class="install-modal-error">{errors()[param.key]}</span>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            <div class="install-modal-footer">
              <button class="install-modal-cancel" onClick={props.onClose}>
                {t("marketplace.install.cancel")}
              </button>
              <button class="install-modal-submit" onClick={handleInstall} disabled={installing()}>
                {installing() ? t("marketplace.install.installing") : t("marketplace.install.submit")}
              </button>
            </div>
          </Show>

          {/* Success/Error State */}
          <Show when={result()}>
            <Show when={result()!.success}>
              <div class="install-modal-result">
                <div class="install-modal-success">
                  <span class="install-modal-checkmark">✓</span>
                  <span>{t("marketplace.install.success")}</span>
                </div>
                <div class="install-modal-footer">
                  <button class="install-modal-submit" onClick={props.onClose}>
                    {t("marketplace.install.done")}
                  </button>
                </div>
              </div>
            </Show>
            <Show when={!result()!.success}>
              <div class="install-modal-result">
                <div class="install-modal-error-msg">{result()!.error ?? t("marketplace.install.failed")}</div>
                <div class="install-modal-footer">
                  <button class="install-modal-cancel" onClick={props.onClose}>
                    {t("marketplace.install.close")}
                  </button>
                </div>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </Show>
  )
}
