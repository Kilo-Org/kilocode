import { Component, Show, For, createMemo } from "solid-js"
import { useVSCode } from "../../context/vscode"
import type { MarketplaceItem, MarketplaceInstalledMetadata } from "../../types/marketplace"
import { isInstalled } from "./MarketplaceListView"

interface MarketplaceItemCardProps {
  item: MarketplaceItem
  metadata: MarketplaceInstalledMetadata
  onInstall: (item: MarketplaceItem) => void
  onRemove: (item: MarketplaceItem, scope: "project" | "global") => void
  onTagClick: (tag: string) => void
}

export const MarketplaceItemCard: Component<MarketplaceItemCardProps> = (props) => {
  const vscode = useVSCode()

  const installed = createMemo(() => isInstalled(props.item.id, props.item.type, props.metadata))

  const openExternal = (url: string) => {
    vscode.postMessage({ type: "openExternal", url })
  }

  return (
    <div class="marketplace-card">
      <div class="marketplace-card-header">
        <div>
          <Show
            when={props.item.type === "mcp" && "url" in props.item && props.item.url}
            fallback={<span class="marketplace-card-name">{props.item.name}</span>}
          >
            <a
              class="marketplace-card-name link"
              href={(props.item as { url: string }).url}
              onClick={(e) => {
                e.preventDefault()
                openExternal((props.item as { url: string }).url)
              }}
            >
              {props.item.name}
            </a>
          </Show>
          <span class="marketplace-card-author">
            {props.item.author && `by ${props.item.author}`}
            <span class="marketplace-card-type">{props.item.type === "mcp" ? "MCP Server" : "Mode"}</span>
          </span>
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
        <For each={props.item.tags ?? []}>
          {(tag) => (
            <button class="marketplace-badge tag" onClick={() => props.onTagClick(tag)}>
              {tag}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
