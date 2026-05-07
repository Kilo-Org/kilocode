// kilocode_change - new file

/**
 * KiloClaw full-screen view
 *
 * Main layout component for the /kiloclaw route.
 * Renders a chat panel on the left and a status sidebar on the right.
 * Escape navigates back to the previous route.
 */

import { createMemo } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { useCommandDialog, type CommandOption } from "@tui/component/dialog-command"
import { Toast } from "@tui/ui/toast"
import { ClawChat } from "./chat"
import { ClawSidebar } from "./sidebar"
import { createClawStatus, createClawChat } from "./hooks"
import { DialogConversationList } from "./dialog-conversation-list"
import type { ClawSlashOption } from "./autocomplete"

export function KiloClawView() {
  const route = useRoute()
  const sdk = useSDK()
  const command = useCommandDialog()
  const dialog = useDialog()

  // Poll instance status
  const { status, error: statusError, loading: statusLoading } = createClawStatus(sdk)

  // Connect to chat
  const chat = createClawChat(sdk)

  // Determine if chat input should be disabled
  const disabled = createMemo(() => {
    const s = status()
    return !s || s.status !== "running"
  })

  // Bot display name — sourced from the KiloClaw platform status (set by the
  // user during onboarding via patchBotIdentity). Falls back to the literal
  // "KiloClaw" while loading or for instances that skipped onboarding,
  // matching the web UI's fallback chain.
  const botName = createMemo(() => status()?.botName ?? "KiloClaw")

  // Register escape to navigate back
  useKeyboard((evt) => {
    if (evt.name === "escape") {
      route.back()
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  // KiloClaw view commands — single source of truth for both the global
  // command palette / keybinds and the in-chat slash autocomplete.
  // The list is reactive on `chat.connected` so the slash menu only
  // exposes `/new` and `/conversations` once we're connected to kilo-chat.
  const kiloCommands = createMemo<CommandOption[]>(() => {
    const ready = chat.connected()
    return [
      {
        value: "kiloclaw.back",
        title: "Back",
        description: "Return to the previous view",
        category: "KiloClaw",
        slash: { name: "back" },
        keybind: "escape" as any,
        onSelect: () => {
          dialog.clear()
          route.back()
        },
      },
      {
        value: "kiloclaw.new",
        title: "New conversation",
        description: "Start a new KiloClaw conversation",
        category: "KiloClaw",
        slash: { name: "new" },
        enabled: ready,
        hidden: !ready,
        onSelect: async () => {
          dialog.clear()
          await chat.newConversation()
        },
      },
      {
        value: "kiloclaw.conversations",
        title: "Conversations",
        description: "Browse, rename, and delete KiloClaw conversations",
        category: "KiloClaw",
        slash: { name: "conversations", aliases: ["chats"] },
        enabled: ready,
        hidden: !ready,
        onSelect: () => {
          dialog.replace(() => <DialogConversationList chat={chat} />)
        },
      },
    ]
  })

  command.register(() => kiloCommands())

  // Slashes for the in-chat autocomplete — derived from the same list so
  // renames flow through automatically. We pad displays to a common width
  // so the descriptions line up like in the main prompt's autocomplete.
  const clawSlashes = createMemo<ClawSlashOption[]>(() => {
    const visible = kiloCommands().filter((c) => c.enabled !== false && !c.hidden && c.slash)
    const items = visible.map((c) => ({
      display: "/" + c.slash!.name,
      description: c.description ?? c.title,
      aliases: c.slash!.aliases?.map((a) => "/" + a),
      onSelect: () => c.onSelect?.(dialog),
    }))
    const max = items.reduce((m, i) => Math.max(m, i.display.length), 0)
    if (!max) return items
    return items.map((i) => ({ ...i, display: i.display.padEnd(max + 2) }))
  })

  return (
    <box flexDirection="row" flexGrow={1} paddingLeft={2} gap={1}>
      <box flexGrow={1} flexDirection="column">
        <ClawChat
          messages={chat.messages()}
          online={chat.online()}
          connected={chat.connected()}
          loading={chat.loading()}
          error={chat.error()}
          disabled={disabled()}
          typingMembers={chat.typingMembers()}
          slashes={clawSlashes}
          botName={botName()}
          onSend={chat.send}
        />
        <Toast />
      </box>
      <ClawSidebar
        status={status()}
        loading={statusLoading()}
        error={statusError()}
        online={chat.online()}
        connected={chat.connected()}
        chatLoading={chat.loading()}
        chatError={chat.error()}
        conversations={chat.conversations()}
        activeConversationId={chat.activeConversationId()}
        conversationStatus={chat.conversationStatus()}
      />
    </box>
  )
}
