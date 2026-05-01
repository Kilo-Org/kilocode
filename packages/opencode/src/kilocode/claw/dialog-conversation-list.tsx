// kilocode_change - new file

/**
 * Conversation selector for the KiloClaw chat.
 *
 * Mirrors the session-list dialog (`cli/cmd/tui/component/dialog-session-list.tsx`):
 *   - DialogSelect-backed list, grouped by date bucket
 *   - "current" marker on the active conversation
 *   - inline rename via DialogPrompt (replace pattern)
 *   - two-press delete confirmation with `theme.error` background
 */

import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useDialog } from "@tui/ui/dialog"
import { useKeybind } from "@tui/context/keybind"
import { useTheme } from "@tui/context/theme"
import { useToast } from "@tui/ui/toast"
import { Locale, Keybind } from "@/util"
import { createMemo, createSignal, onMount } from "solid-js"
import type { ClawChat } from "./hooks"

type Props = {
  chat: ClawChat
}

export function DialogConversationList(props: Props) {
  const dialog = useDialog()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const toast = useToast()
  const [toDelete, setToDelete] = createSignal<string>()

  const options = createMemo(() => {
    const today = new Date().toDateString()
    const list = [...props.chat.conversations()]
    list.sort((a, b) => {
      const ax = a.lastActivityAt ?? a.joinedAt
      const bx = b.lastActivityAt ?? b.joinedAt
      return bx - ax
    })
    return list.map((c) => {
      const ts = c.lastActivityAt ?? c.joinedAt
      const date = new Date(ts)
      let category = date.toDateString()
      if (category === today) category = "Today"
      const isDeleting = toDelete() === c.conversationId
      return {
        title: isDeleting ? `Press ${keybind.print("session_delete")} again to confirm` : (c.title ?? "Untitled"),
        bg: isDeleting ? theme.error : undefined,
        value: c.conversationId,
        category,
        footer: Locale.time(ts),
      }
    })
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="KiloClaw Conversations"
      options={options()}
      current={props.chat.activeConversationId() ?? undefined}
      onMove={() => setToDelete(undefined)}
      onSelect={async (option) => {
        await props.chat.selectConversation(option.value)
        dialog.clear()
      }}
      keybind={[
        {
          keybind: keybind.all.session_delete?.[0],
          title: "delete",
          onTrigger: async (option) => {
            if (toDelete() === option.value) {
              // `deleteConversation` already catches internally and returns
              // a boolean; its outer promise never rejects here.
              const ok = await props.chat.deleteConversation(option.value)
              if (!ok) {
                toast.show({
                  variant: "error",
                  title: "Failed to delete conversation",
                  message: "Please try again.",
                })
              }
              setToDelete(undefined)
              return
            }
            setToDelete(option.value)
          },
        },
        {
          keybind: keybind.all.session_rename?.[0],
          title: "rename",
          onTrigger: async (option) => {
            const item = props.chat.conversations().find((c) => c.conversationId === option.value)
            const list = () => dialog.replace(() => <DialogConversationList chat={props.chat} />)
            dialog.replace(() => (
              <DialogPrompt
                title="Rename Conversation"
                value={item?.title ?? ""}
                placeholder="Enter a title"
                onConfirm={async (value) => {
                  const trimmed = value.trim()
                  if (trimmed) {
                    await props.chat.renameConversation(option.value, trimmed)
                  }
                  list()
                }}
                onCancel={list}
              />
            ))
          },
        },
        {
          keybind: Keybind.parse("ctrl+n")[0],
          title: "new",
          side: "right",
          onTrigger: async () => {
            await props.chat.newConversation()
            dialog.clear()
          },
        },
      ]}
    />
  )
}
