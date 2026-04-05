import { Show, JSX, createSignal, onMount } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Card } from "@kilocode/kilo-ui/card"
import { Tag } from "@kilocode/kilo-ui/tag"
import type { MarketplaceItem, MarketplaceInstalledMetadata } from "../../types/marketplace"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { installedScopes } from "./utils"

interface Props {
  item: MarketplaceItem
  metadata: MarketplaceInstalledMetadata
  displayName?: string
  linkUrl?: string
  onInstall: (item: MarketplaceItem) => void
  onRemove: (item: MarketplaceItem, scope: "project" | "global") => void
  footer?: JSX.Element
}

export const ItemCard = (props: Props) => {
  const vscode = useVSCode()
  const { t } = useLanguage()
  const scopes = () => installedScopes(props.item.id, props.item.type, props.metadata)
  const installed = () => scopes().length > 0
  const name = () => props.displayName ?? props.item.name
  const [expanded, setExpanded] = createSignal(false)
  const [clamped, setClamped] = createSignal(false)
  let ref: HTMLParagraphElement | undefined

  onMount(() => {
    if (ref && ref.scrollHeight > ref.clientHeight) setClamped(true)
  })

  const openLink = (url: string) => {
    vscode.postMessage({ type: "openExternal", url })
  }

  return (
    <Card class="marketplace-card">
      <div class="marketplace-card-header">
        <div class="marketplace-card-title">
          <Show when={props.linkUrl} fallback={<span class="marketplace-card-name">{name()}</span>}>
            <span class="marketplace-card-name clickable" onClick={() => openLink(props.linkUrl!)}>
              {name()}
            </span>
          </Show>
        </div>
        <Show when={props.item.author}>
          <span class="marketplace-card-author">
            <Show when={props.item.authorUrl} fallback={t("marketplace.card.by", { author: props.item.author! })}>
              <span class="link" onClick={() => openLink(props.item.authorUrl!)}>
                {t("marketplace.card.by", { author: props.item.author! })}
              </span>
            </Show>
          </span>
        </Show>
      </div>
      <p ref={ref} class="marketplace-card-description" classList={{ expanded: expanded() }}>
        {props.item.description}
      </p>
      <Show when={clamped()}>
        <button class="marketplace-card-expand" onClick={() => setExpanded(!expanded())}>
          {expanded() ? t("marketplace.card.showLess") : t("marketplace.card.showMore")}
        </button>
      </Show>
      <div class="marketplace-card-footer">
        <div class="marketplace-card-tags">
          <Show when={installed()}>
            <Tag class="marketplace-badge-installed">{t("marketplace.card.installed")}</Tag>
          </Show>
          {props.footer}
        </div>
        <div class="marketplace-card-actions">
          <Show
            when={installed()}
            fallback={
              <Button size="small" onClick={() => props.onInstall(props.item)}>
                {t("marketplace.card.install")}
              </Button>
            }
          >
            {scopes().map((scope) => (
              <Button
                size="small"
                variant="ghost"
                class="marketplace-remove-btn"
                onClick={() => props.onRemove(props.item, scope)}
              >
                {scopes().length > 1
                  ? t("marketplace.card.removeScope", { scope: t(`marketplace.scope.${scope}`) })
                  : t("marketplace.card.remove")}
              </Button>
            ))}
          </Show>
        </div>
      </div>
    </Card>
  )
}
