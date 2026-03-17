import { Component, createSignal, onMount, onCleanup, Show, For } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { RadioGroup } from "@kilocode/kilo-ui/radio-group"
import { useVSCode } from "../../context/vscode"
import { useServer } from "../../context/server"
import { useLanguage } from "../../context/language"
import type { MarketplaceItem } from "../../types/marketplace"

interface ScopeOption {
  value: "project" | "global"
  label: string
  disabled?: boolean
}

interface Props {
  item: MarketplaceItem
  onClose: () => void
  onInstallResult?: (success: boolean) => void
}

const InstallModal: Component<Props> = (props) => {
  const vscode = useVSCode()
  const server = useServer()
  const { t } = useLanguage()

  const workspace = () => server.workspaceDirectory()
  const scopeOptions = (): ScopeOption[] => [
    { value: "project", label: t("marketplace.install.scope.project"), disabled: !workspace() },
    { value: "global", label: t("marketplace.install.scope.global") },
  ]
  const [scope, setScope] = createSignal<ScopeOption>(workspace() ? scopeOptions()[0] : scopeOptions()[1])
  const [installing, setInstalling] = createSignal(false)
  const [result, setResult] = createSignal<{ success: boolean; error?: string } | null>(null)

  const prerequisites = () => props.item.prerequisites ?? []

  onMount(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data
      if (msg?.type === "marketplaceInstallResult" && msg.slug === props.item.id) {
        setInstalling(false)
        setResult({ success: msg.success, error: msg.error })
        props.onInstallResult?.(msg.success)
      }
    }
    window.addEventListener("message", handler)
    onCleanup(() => window.removeEventListener("message", handler))
  })

  const handleInstall = () => {
    setInstalling(true)
    vscode.postMessage({
      type: "installMarketplaceItem",
      mpItem: props.item,
      mpInstallOptions: { target: scope().value },
    })
  }

  return (
    <div class="marketplace-modal-overlay" onClick={() => !installing() && props.onClose()}>
      <div class="marketplace-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("marketplace.install.title", { name: props.item.name })}</h3>

        <Show when={!result()}>
          <div class="marketplace-modal-section">
            <label>{t("marketplace.install.scope")}</label>
            <RadioGroup
              options={scopeOptions()}
              current={scope()}
              value={(x: ScopeOption) => x.value}
              label={(x: ScopeOption) => x.label}
              onSelect={(v: ScopeOption | undefined) => v && setScope(v)}
            />
          </div>

          <Show when={prerequisites().length > 0}>
            <div class="marketplace-modal-section">
              <label>{t("marketplace.install.prerequisites")}</label>
              <ul class="marketplace-prerequisites">
                <For each={prerequisites()}>{(p) => <li>{p}</li>}</For>
              </ul>
            </div>
          </Show>

          <div class="marketplace-modal-actions">
            <Button variant="secondary" onClick={props.onClose} disabled={installing()}>
              {t("marketplace.install.cancel")}
            </Button>
            <Button variant="primary" onClick={handleInstall} disabled={installing()}>
              {installing() ? t("marketplace.install.installing") : t("marketplace.card.install")}
            </Button>
          </div>
        </Show>

        <Show when={result()}>
          {(r) => (
            <div class="marketplace-modal-result">
              <Show
                when={r().success}
                fallback={
                  <>
                    <p class="marketplace-error">{r().error ?? t("marketplace.install.failed")}</p>
                    <Button onClick={props.onClose}>{t("marketplace.install.close")}</Button>
                  </>
                }
              >
                <p class="marketplace-success">{t("marketplace.install.success")}</p>
                <Button onClick={props.onClose}>{t("marketplace.install.done")}</Button>
              </Show>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}

export default InstallModal
