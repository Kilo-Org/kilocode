import { For, type Component } from "solid-js"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { parseBindingTokens } from "./keybind-tokens"
import type { ShortcutCategory } from "./shortcuts"

export const ShortcutsDialog: Component<{ title: string; categories: ShortcutCategory[] }> = (props) => (
  <Dialog title={props.title} fit>
    <div class="am-shortcuts">
      <For each={props.categories}>
        {(category) => (
          <div class="am-shortcuts-category">
            <div class="am-shortcuts-category-title">{category.title}</div>
            <div class="am-shortcuts-list">
              <For each={category.shortcuts}>
                {(shortcut) => (
                  <div class="am-shortcuts-row">
                    <span class="am-shortcuts-label">{shortcut.label}</span>
                    <span class="am-shortcuts-keys">
                      <For each={parseBindingTokens(shortcut.binding)}>
                        {(token) => <kbd class="am-kbd">{token}</kbd>}
                      </For>
                    </span>
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  </Dialog>
)
