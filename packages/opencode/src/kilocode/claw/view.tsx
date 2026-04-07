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
import { useCommandDialog } from "@tui/component/dialog-command"
import { Toast } from "@tui/ui/toast"
import { ClawChat } from "./chat"
import { ClawSidebar } from "./sidebar"
import { createClawStatus, createClawChat } from "./hooks"

export function KiloClawView() {
  const route = useRoute()
  const sdk = useSDK()
  const command = useCommandDialog()

  // Poll instance status
  const { status, error: statusError, loading: statusLoading } = createClawStatus(sdk)

  // Connect to chat
  const chat = createClawChat(sdk)

  // Determine if chat input should be disabled
  const disabled = createMemo(() => {
    const s = status()
    return !s || s.status !== "running"
  })

  // Register escape to navigate back
  useKeyboard((evt) => {
    if (evt.name === "escape") {
      route.back()
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  // Register view-specific commands
  command.register(() => [
    {
      value: "kiloclaw.back",
      title: "Back",
      category: "KiloClaw",
      hidden: true,
      keybind: "escape" as any,
      onSelect: () => {
        route.back()
      },
    },
  ])

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
      />
    </box>
  )
}
