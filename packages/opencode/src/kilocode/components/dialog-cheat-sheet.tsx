// kilocode_change - new file

import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useKeybind } from "@tui/context/keybind"
import { For, createMemo, onMount } from "solid-js"
import type { KeybindsConfig } from "@kilocode/sdk/v2"

type Shortcut = {
  key: string
  description: string
}

type Category = {
  title: string
  shortcuts: Shortcut[]
}

export function DialogCheatSheet() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const dimensions = useTerminalDimensions()

  onMount(() => {
    dialog.setSize("large")
  })

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "escape") {
      dialog.clear()
    }
  })

  function kb(key: keyof KeybindsConfig): string {
    return keybind.print(key) || "—"
  }

  const categories = createMemo<Category[]>(() => [
    {
      title: "General",
      shortcuts: [
        { key: kb("command_list"), description: "Command palette" },
        { key: kb("app_exit"), description: "Exit" },
        { key: kb("terminal_suspend"), description: "Suspend terminal" },
        { key: kb("editor_open"), description: "Open external editor" },
        { key: "!", description: "Shell mode" },
      ],
    },
    {
      title: "Session",
      shortcuts: [
        { key: kb("session_new"), description: "New session" },
        { key: kb("session_list"), description: "Switch session" },
        { key: kb("session_interrupt"), description: "Stop response" },
        { key: kb("session_compact"), description: "Compact session" },
        { key: kb("session_export"), description: "Export transcript" },
        { key: kb("session_timeline"), description: "Jump to message" },
        { key: kb("session_rename"), description: "Rename session" },
      ],
    },
    {
      title: "Navigation",
      shortcuts: [
        { key: kb("messages_page_up"), description: "Page up" },
        { key: kb("messages_page_down"), description: "Page down" },
        { key: kb("messages_first"), description: "First message" },
        { key: kb("messages_last"), description: "Last message" },
        { key: kb("messages_copy"), description: "Copy last response" },
        { key: kb("messages_undo"), description: "Undo" },
        { key: kb("messages_redo"), description: "Redo" },
        { key: kb("sidebar_toggle"), description: "Toggle sidebar" },
      ],
    },
    {
      title: "Agent & Model",
      shortcuts: [
        { key: kb("agent_cycle"), description: "Next agent" },
        { key: kb("agent_cycle_reverse"), description: "Previous agent" },
        { key: kb("agent_list"), description: "Switch agent" },
        { key: kb("model_list"), description: "Switch model" },
        { key: kb("model_cycle_recent"), description: "Cycle recent models" },
        { key: kb("theme_list"), description: "Switch theme" },
        { key: kb("status_view"), description: "View status" },
      ],
    },
    {
      title: "Input",
      shortcuts: [
        { key: kb("input_submit"), description: "Send message" },
        { key: kb("input_newline"), description: "New line" },
        { key: kb("input_paste"), description: "Paste / paste image" },
        { key: kb("input_clear"), description: "Clear input" },
        { key: "@", description: "Attach file" },
      ],
    },
  ])

  const height = createMemo(() => Math.min(dimensions().height - 6, 30))

  return (
    <box paddingLeft={2} paddingRight={2} gap={0}>
      <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Keyboard Shortcuts
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <scrollbox height={height()}>
        <box gap={1}>
          <For each={categories()}>
            {(category) => (
              <box gap={0}>
                <text attributes={TextAttributes.BOLD} fg={theme.warning}>
                  {category.title}
                </text>
                <For each={category.shortcuts}>
                  {(shortcut) => (
                    <box flexDirection="row" gap={1}>
                      <box width={24} flexShrink={0}>
                        <text fg={theme.primary}>{shortcut.key}</text>
                      </box>
                      <text fg={theme.textMuted}>{shortcut.description}</text>
                    </box>
                  )}
                </For>
              </box>
            )}
          </For>
        </box>
      </scrollbox>
      <box paddingTop={1} paddingBottom={1} flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>Tip: Leader key is {kb("leader")}. Keybinds are configurable.</text>
        <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={() => dialog.clear()}>
          <text fg={theme.selectedListItemText}>ok</text>
        </box>
      </box>
    </box>
  )
}
