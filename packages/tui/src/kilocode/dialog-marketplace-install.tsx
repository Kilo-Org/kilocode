import { useTerminalDimensions } from "@opentui/solid"
import { Keymap } from "../context/keymap"
import { DialogHeader, DialogLayout } from "../ui/dialog"

/** Keep the complete configuration reviewable, including on short terminals. */
export function DialogMarketplaceInstall(props: {
  title: string
  message: string
  onChoose: (confirmed: boolean) => void
}) {
  const dimensions = useTerminalDimensions()
  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "return", title: "Install", group: "Dialog", run: () => props.onChoose(true) },
      { bind: "escape", title: "Cancel", group: "Dialog", run: () => props.onChoose(false) },
    ],
  }))
  return (
    <DialogLayout
      header={<DialogHeader title={props.title} />}
      footer={{
        actions: {
          primary: [
            { title: "cancel", key: "esc", onTrigger: () => props.onChoose(false) },
            { title: "install", key: "enter", onTrigger: () => props.onChoose(true) },
          ],
        },
      }}
    >
      <scrollbox
        id="marketplace-install-preview"
        focused
        maxHeight={Math.max(1, Math.floor(dimensions().height * 0.75) - 8)}
        contentOptions={{ minHeight: 0 }}
      >
        <text>{props.message}</text>
      </scrollbox>
    </DialogLayout>
  )
}
