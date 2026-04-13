import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { createMemo } from "solid-js"
import { useSDK } from "../context/sdk"

interface DialogSessionRenameProps {
  session: string
  title?: string // kilocode_change
  onConfirm?: () => void // kilocode_change
}

export function DialogSessionRename(props: DialogSessionRenameProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const session = createMemo(() => sync.session.get(props.session))

  return (
    <DialogPrompt
      title="Rename Session"
      value={session()?.title ?? props.title} // kilocode_change
      onConfirm={(value) => {
        // kilocode_change start
        sdk.client.session
          .update({
            sessionID: props.session,
            title: value,
          })
          .then(() => props.onConfirm?.())
        // kilocode_change end
        dialog.clear()
      }}
      onCancel={() => dialog.clear()}
    />
  )
}
