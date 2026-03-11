import { Component, Show, createMemo } from "solid-js"
import { useVSCode } from "../../context/vscode"
import type { MarketplaceItem, MarketplaceInstalledMetadata, SkillMarketplaceItem } from "../../types/marketplace"
import { isInstalled } from "./MarketplaceListView"

interface SkillItemCardProps {
  item: SkillMarketplaceItem
  metadata: MarketplaceInstalledMetadata
  onInstall: (item: MarketplaceItem) => void
  onRemove: (item: MarketplaceItem, scope: "project" | "global") => void
}

export const SkillItemCard: Component<SkillItemCardProps> = (props) => {
  const vscode = useVSCode()

  const installed = createMemo(() => isInstalled(props.item.id, props.item.type, props.metadata))

  const openExternal = (url: string) => {
    vscode.postMessage({ type: "openExternal", url })
  }

  return (
    <div class="skill-card">
      <div class="marketplace-card-header">
        <div>
          <Show
            when={props.item.githubUrl}
            fallback={<span class="marketplace-card-name">{props.item.displayName}</span>}
          >
            <a
              class="marketplace-card-name link"
              href={props.item.githubUrl}
              onClick={(e) => {
                e.preventDefault()
                openExternal(props.item.githubUrl)
              }}
            >
              {props.item.displayName}
            </a>
          </Show>
          <span class="marketplace-card-author">{props.item.author && `by ${props.item.author}`}</span>
        </div>
        <Show
          when={installed()}
          fallback={
            <button class="marketplace-install-btn" onClick={() => props.onInstall(props.item)}>
              Install
            </button>
          }
        >
          <button
            class="marketplace-remove-btn"
            onClick={() => props.onRemove(props.item, installed() as "project" | "global")}
          >
            Remove
          </button>
        </Show>
      </div>
      <p class="marketplace-card-description">{props.item.description}</p>
      <div class="marketplace-card-footer">
        <Show when={installed()}>
          <span class="marketplace-badge installed">Installed</span>
        </Show>
        <Show when={props.item.displayCategory}>
          <span class="marketplace-badge tag">{props.item.displayCategory}</span>
        </Show>
      </div>
    </div>
  )
}
