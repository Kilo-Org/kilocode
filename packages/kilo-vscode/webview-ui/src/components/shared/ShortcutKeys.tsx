import { For, type Component } from "solid-js"
import { parseBindingGroups } from "../../utils/keybind-tokens"

/**
 * Render a formatted keybinding string as VS Code style keycaps.
 *
 * Shared by the prompt placeholder hint and the settings search so both use
 * the same key parsing and keycap markup. Pass a display binding such as
 * "⌘F" (macOS) or "Ctrl+F" (Windows/Linux).
 */
export const ShortcutKeys: Component<{ binding: string; class?: string }> = (props) => (
  <span class={props.class ? `shortcut-keys ${props.class}` : "shortcut-keys"}>
    <For each={parseBindingGroups(props.binding)}>
      {(group) => (
        <span class="shortcut-keys-group">
          <For each={group}>{(key) => <kbd class="shortcut-key">{key}</kbd>}</For>
        </span>
      )}
    </For>
  </span>
)
