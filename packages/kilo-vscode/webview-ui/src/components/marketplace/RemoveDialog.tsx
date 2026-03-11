import { Component, Show, createMemo } from "solid-js"
import type { MarketplaceItem } from "../../types/marketplace"

interface RemoveDialogProps {
  item: MarketplaceItem | null
  scope: "project" | "global"
  onClose: () => void
  onConfirm: () => void
}

export const RemoveDialog: Component<RemoveDialogProps> = (props) => {
  const label = createMemo(() => {
    if (!props.item) return ""
    if (props.item.type === "mcp") return "MCP server"
    if (props.item.type === "skill") return "skill"
    return "mode"
  })

  return (
    <Show when={props.item}>
      <div class="install-modal-overlay" onClick={props.onClose}>
        <div class="install-modal" onClick={(e) => e.stopPropagation()}>
          <div class="install-modal-header">
            <h3>Remove {props.item!.name}?</h3>
          </div>
          <div class="install-modal-body">
            <p>
              Are you sure you want to remove this {label()}? This will remove it from your {props.scope} configuration.
            </p>
          </div>
          <div class="install-modal-footer">
            <button class="install-modal-cancel" onClick={props.onClose}>
              Cancel
            </button>
            <button class="install-modal-submit danger" onClick={props.onConfirm}>
              Remove
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}
