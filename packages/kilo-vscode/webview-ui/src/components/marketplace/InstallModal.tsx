import { createSignal, createEffect, onCleanup, Show, For } from "solid-js"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Button } from "@kilocode/kilo-ui/button"
import { RadioGroup } from "@kilocode/kilo-ui/radio-group"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useVSCode } from "../../context/vscode"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import { useMarketplaceSession } from "../../context/marketplace-session"
import type { MarketplaceItem, McpMarketplaceItem, McpInstallationMethod, McpParameter } from "../../types/marketplace"

interface ScopeOption {
  value: "project" | "global"
  label: string
}

const MARKETPLACE_DOCS = "https://kilo.ai/docs/customize/marketplace"
const MCP_DOCS = "https://kilo.ai/docs/automate/mcp/what-is-mcp"

interface Props {
  item: MarketplaceItem
  onClose: () => void
  onInstallResult: (
    success: boolean,
    scope: "project" | "global",
    extra?: { hasParameters?: boolean; installationMethodName?: string },
  ) => void
}

export const InstallModal = (props: Props) => {
  const vscode = useVSCode()
  const server = useServer()
  const { t } = useLanguage()
  const session = useMarketplaceSession()

  const workspace = () => server.workspaceDirectory()
  const options = (): ScopeOption[] =>
    workspace()
      ? [
          { value: "project", label: t("marketplace.scope.project") },
          { value: "global", label: t("marketplace.scope.global") },
        ]
      : [{ value: "global", label: t("marketplace.scope.global") }]
  const initial = workspace() ? options()[0] : options()[0]
  const [scope, setScope] = createSignal<ScopeOption>(initial)
  const [installing, setInstalling] = createSignal(false)
  const [result, setResult] = createSignal<{
    success: boolean
    error?: string
    scope: "project" | "global"
    path: string
    hasParameters: boolean
    method?: string
  } | null>(null)
  const [params, setParams] = createSignal<Record<string, string>>({})
  const [pending, setPending] = createSignal<{
    scope: "project" | "global"
    path: string
    hasParameters: boolean
    method?: string
  } | null>(null)

  const destination = (target = scope().value) => {
    const base = target === "project" ? ".kilo" : "~/.config/kilo"
    if (props.item.type === "mcp") return `${base}/kilo.json`
    if (props.item.type === "agent") return `${base}/agents/${props.item.id}.md`
    if (target === "project") return `.kilo/skills/${props.item.id}/`
    return `~/.kilo/skills/${props.item.id}/`
  }
  const about = () => t(`marketplace.install.about.${props.item.type}`)
  const scopeDescription = () => t(`marketplace.install.scope.${scope().value}.description`)
  const openDocs = (url: string) => vscode.postMessage({ type: "openExternal", url })

  // MCP installation methods
  const methods = (): McpInstallationMethod[] => {
    if (props.item.type !== "mcp") return []
    const mcp = props.item as McpMarketplaceItem
    if (!Array.isArray(mcp.content)) return []
    return mcp.content
  }

  const [method, setMethod] = createSignal<McpInstallationMethod | undefined>(methods()[0])

  const prerequisites = (): string[] => {
    if (method()?.prerequisites?.length) return method()!.prerequisites!
    return props.item.prerequisites ?? []
  }

  const parameters = (): McpParameter[] => {
    if (method()?.parameters?.length) return method()!.parameters!
    if (props.item.type === "mcp") return (props.item as McpMarketplaceItem).parameters ?? []
    return []
  }

  const valid = () => {
    for (const param of parameters()) {
      if (!param.optional && !params()[param.key]?.trim()) return false
    }
    return true
  }

  const setParam = (key: string, value: string) => {
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  createEffect(() => {
    const unsub = vscode.onMessage((msg) => {
      if (msg.type === "marketplaceInstallResult" && msg.slug === props.item.id) {
        const request = pending()
        setInstalling(false)
        if (!request) return
        setResult({ success: msg.success, error: msg.error, ...request })
        props.onInstallResult(msg.success, request.scope, {
          hasParameters: request.hasParameters,
          installationMethodName: request.method,
        })
        setPending(null)
      }
    })
    onCleanup(unsub)
  })

  const doInstall = () => {
    setInstalling(true)
    const paramValues: Record<string, unknown> = { ...params() }
    const current = method()
    if (current) {
      paramValues.__method = current.name
    }
    const target = scope().value
    setPending({
      scope: target,
      path: destination(target),
      hasParameters: Object.keys(params()).length > 0,
      method: current?.name,
    })
    vscode.postMessage({
      type: "installMarketplaceItem",
      mpItem: props.item,
      mpInstallOptions: {
        target,
        parameters: Object.keys(paramValues).length > 0 ? paramValues : undefined,
      },
    })
  }

  const handleInstall = () => {
    const busy = Object.values(session.allStatusMap()).filter((s) => s.type === "busy").length
    if (busy === 0) {
      doInstall()
      return
    }
    const msg = busy === 1 ? t("marketplace.warning.busyOne") : t("marketplace.warning.busyMany")
    showToast({
      variant: "error",
      title: msg,
      persistent: true,
      actions: [
        { label: t("marketplace.warning.installAnyway"), onClick: doInstall },
        { label: t("marketplace.warning.cancel"), onClick: "dismiss" },
      ],
    })
  }

  return (
    <Dialog title={t("marketplace.install.title", { name: props.item.name })} fit>
      <Show when={!result()}>
        <div class="install-modal-body">
          <div class="install-modal-about">
            <p>{about()}</p>
            <div class="install-modal-links">
              <button type="button" class="link" onClick={() => openDocs(MARKETPLACE_DOCS)}>
                {t("marketplace.install.learnMore")}
              </button>
              <Show when={props.item.type === "mcp"}>
                <button type="button" class="link" onClick={() => openDocs(MCP_DOCS)}>
                  {t("marketplace.install.learnMcp")}
                </button>
              </Show>
            </div>
          </div>

          <div class="install-modal-section">
            <span class="install-modal-label">{t("marketplace.install.scope")}</span>
            <RadioGroup
              options={options()}
              current={scope()}
              value={(x: ScopeOption) => x.value}
              label={(x: ScopeOption) => x.label}
              onSelect={(v: ScopeOption | undefined) => v && setScope(v)}
            />
            <p class="install-modal-help">{scopeDescription()}</p>
            <div class="install-modal-destination">
              <span>{t("marketplace.install.destination")}</span>
              <code>{destination()}</code>
            </div>
          </div>

          <Show when={props.item.type === "mcp" || scope().value === "project"}>
            <div class="install-modal-warning">
              <Show when={props.item.type === "mcp"}>
                <p>{t("marketplace.install.mcp.warning")}</p>
              </Show>
              <Show when={scope().value === "project"}>
                <p>{t("marketplace.install.project.warning")}</p>
              </Show>
            </div>
          </Show>

          <Show when={methods().length > 1}>
            <div class="install-modal-section">
              <span class="install-modal-label">{t("marketplace.install.method")}</span>
              <Select
                options={methods()}
                current={method()}
                value={(m: McpInstallationMethod) => m.name}
                label={(m: McpInstallationMethod) => m.name}
                onSelect={(v: McpInstallationMethod | undefined) => {
                  if (v) {
                    setMethod(v)
                    setParams({})
                  }
                }}
              />
            </div>
          </Show>

          <Show when={prerequisites().length > 0}>
            <div class="install-modal-section">
              <span class="install-modal-label">{t("marketplace.install.prerequisites")}</span>
              <ul class="install-modal-prerequisites">
                <For each={prerequisites()}>{(p) => <li>{p}</li>}</For>
              </ul>
            </div>
          </Show>

          <Show when={parameters().length > 0}>
            <div class="install-modal-section">
              <span class="install-modal-label">{t("marketplace.install.parameters")}</span>
              <For each={parameters()}>
                {(param) => (
                  <div class="install-modal-param">
                    <TextField
                      label={param.name + (param.optional ? ` (${t("marketplace.install.optional")})` : "")}
                      placeholder={param.placeholder ?? ""}
                      value={params()[param.key] ?? ""}
                      onChange={(v: string) => setParam(param.key, v)}
                    />
                  </div>
                )}
              </For>
            </div>
          </Show>

          <div class="install-modal-footer">
            <Button variant="secondary" onClick={props.onClose} disabled={installing()}>
              {t("marketplace.install.cancel")}
            </Button>
            <Button variant="primary" onClick={handleInstall} disabled={installing() || !valid()}>
              <Show when={installing()} fallback={t("marketplace.install")}>
                <Spinner /> {t("marketplace.install.installing")}
              </Show>
            </Button>
          </div>
        </div>
      </Show>

      <Show when={result()}>
        {(r) => (
          <div class="install-modal-result">
            <Show
              when={r().success}
              fallback={
                <>
                  <p class="install-modal-error-msg">{r().error ?? t("marketplace.install.failed")}</p>
                  <div class="install-modal-footer">
                    <Button onClick={props.onClose}>{t("marketplace.install.close")}</Button>
                  </div>
                </>
              }
            >
              <p class="install-modal-success">{t("marketplace.install.success")}</p>
              <p class="install-modal-result-path">{t("marketplace.install.installedAt", { path: r().path })}</p>
              <div class="install-modal-footer">
                <Button onClick={props.onClose}>{t("marketplace.install.done")}</Button>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </Dialog>
  )
}
