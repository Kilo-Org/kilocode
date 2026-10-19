import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout, useDialog, type DialogContext } from "./dialog"

export function DialogExportResult(props: { path: string; onClose?: () => void }) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")

  const close = () => {
    props.onClose?.()
    dialog.clear()
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: "Close export result",
        group: "Dialog",
        run: close,
      },
    ],
  }))

  return (
    <DialogLayout
      header={<DialogHeader title="Session exported" onClose={close} />}
      footer={
        <box flexDirection="row" justifyContent="flex-end" gap={1}>
          <box
            paddingLeft={3}
            paddingRight={3}
            backgroundColor={theme.background.action.primary.focused}
            onMouseUp={close}
          >
            <text fg={theme.text.action.primary.focused}>Close</text>
          </box>
        </box>
      }
    >
      <text fg={theme.text.base}>{props.path}</text>
    </DialogLayout>
  )
}

DialogExportResult.show = (dialog: DialogContext, path: string) =>
  new Promise<void>((resolve) => {
    dialog.replace(() => <DialogExportResult path={path} onClose={resolve} />, resolve)
  })
