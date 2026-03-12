import { Component, Show, For, createMemo, JSX } from "solid-js"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import type { MarketplaceItem, MarketplaceInstalledMetadata } from "../../types/marketplace"
import { isInstalled } from "./utils"

interface ItemCardProps {
  item: MarketplaceItem
  metadata: MarketplaceInstalledMetadata
  onInstall: (item: MarketplaceItem) => void
  onRemove: (item: MarketplaceItem, scope: "project" | "global") => void
  /** Display name override (defaults to item.name) */
  displayName?: string
  /** External link URL (e.g. item.url for MCPs, item.githubUrl for skills) */
  linkUrl?: string
  /** Type badge text shown next to author (e.g. "MCP Server", "Mode") */
  typeBadge?: string
  /** Footer content rendered after the installed badge */
  footer?: JSX.Element
}

export const ItemCard: Component<ItemCardProps> = (props) => {
  const vscode = useVSCode()
  const { t } = useLanguage()

  const installed = createMemo(() => isInstalled(props.item.id, props.item.type, props.metadata))

  const name = () => props.displayName ?? props.item.name

  const openExternal = (url: string) => {
    vscode.postMessage({ type: "openExternal", url })
  }

  return (
    <div class="marketplace-card">
      <div class="marketplace-card-header">
        <div>
          <Show when={props.linkUrl} fallback={<span class="marketplace-card-name">{name()}</span>}>
            <a
              class="marketplace-card-name link"
              href={props.linkUrl}
              onClick={(e) => {
                e.preventDefault()
                openExternal(props.linkUrl!)
              }}
            >
              {name()}
            </a>
          </Show>
          <span class="marketplace-card-author">
            {props.item.author && t("marketplace.card.by", { author: props.item.author })}
            <Show when={props.typeBadge}>
              <span class="marketplace-card-type">{props.typeBadge}</span>
            </Show>
          </span>
        </div>
        <Show
          when={installed()}
          fallback={
            <button class="marketplace-install-btn" onClick={() => props.onInstall(props.item)}>
              {t("marketplace.card.install")}
            </button>
          }
        >
          <button
            class="marketplace-remove-btn"
            onClick={() => props.onRemove(props.item, installed() as "project" | "global")}
          >
            {t("marketplace.card.remove")}
          </button>
        </Show>
      </div>
      <p class="marketplace-card-description">{props.item.description}</p>
      <div class="marketplace-card-footer">
        <Show when={installed()}>
          <span class="marketplace-badge installed">{t("marketplace.badge.installed")}</span>
        </Show>
        {props.footer}
      </div>
    </div>
  )
}
