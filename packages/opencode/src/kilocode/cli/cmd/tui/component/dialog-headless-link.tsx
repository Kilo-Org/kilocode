// kilocode_change - new file
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { useBindings } from "@tui/keymap"

export type DialogHeadlessLinkProps = {
  url: string
}

export function DialogHeadlessLink(props: DialogHeadlessLinkProps) {
  const dialog = useDialog()
  const { theme } = useTheme()

  useBindings(() => ({
    bindings: [
      { key: "return", desc: "Close dialog", group: "Dialog", cmd: () => dialog.clear() },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          No display detected
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box paddingBottom={1} flexDirection="column" gap={0}>
        <text fg={theme.textMuted}>Read the docs at:</text>
        <text fg={theme.accent}>{props.url}</text>
      </box>
    </box>
  )
}

DialogHeadlessLink.show = (dialog: DialogContext, url: string) => {
  dialog.replace(() => <DialogHeadlessLink url={url} />)
}
