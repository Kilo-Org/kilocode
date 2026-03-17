import { Component, Show, JSX } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Tag } from "@kilocode/kilo-ui/tag"
import type { MarketplaceItem, MarketplaceInstalledMetadata } from "../../types/marketplace"
import { useLanguage } from "../../context/language"
import { installedScopes } from "./utils"

interface Props {
  item: MarketplaceItem
  metadata: MarketplaceInstalledMetadata
  displayName?: string
  linkUrl?: string
  typeBadge?: string
  onInstall: (item: MarketplaceItem) => void
  onRemove: (item: MarketplaceItem, scope: "project" | "global") => void
  footer?: JSX.Element
}

const ItemCard: Component<Props> = (props) => {
  const { t } = useLanguage()
  const scopes = () => installedScopes(props.item.id, props.item.type, props.metadata)
  const installed = () => scopes().length > 0
  const name = () => props.displayName ?? props.item.name

  return (
    <div class="marketplace-card">
      <div class="marketplace-card-header">
        <div class="marketplace-card-title">
          <Show when={props.linkUrl} fallback={<span class="marketplace-card-name">{name()}</span>}>
            <a
              class="marketplace-card-name marketplace-card-link"
              href={props.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {name()}
            </a>
          </Show>
          <Show when={props.typeBadge}>
            <Tag>{props.typeBadge}</Tag>
          </Show>
        </div>
        <Show when={props.item.author}>
          <span class="marketplace-card-author">{props.item.author}</span>
        </Show>
      </div>
      <p class="marketplace-card-description">{props.item.description}</p>
      <div class="marketplace-card-footer">
        <div class="marketplace-card-tags">
          <Show when={installed()}>
            <Tag class="marketplace-installed-tag">{t("marketplace.card.installed")}</Tag>
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
              <Button size="small" class="marketplace-remove-btn" onClick={() => props.onRemove(props.item, scope)}>
                {scopes().length > 1 ? t("marketplace.card.removeScope", { scope }) : t("marketplace.card.remove")}
              </Button>
            ))}
          </Show>
        </div>
      </div>
    </div>
  )
}

export default ItemCard
