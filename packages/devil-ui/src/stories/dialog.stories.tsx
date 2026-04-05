/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Dialog as KobalteDialog } from "@kobalte/core/dialog"

const meta: Meta = {
  title: "Components/Dialog",
  decorators: [
    (Story) => (
      <div style={{ padding: "32px" }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj

function DialogDemo(props: { size?: "normal" | "large" | "x-large"; title?: string; description?: string }) {
  return (
    <KobalteDialog>
      <KobalteDialog.Trigger as={Button} variant="secondary">
        Open {props.size ?? "normal"} dialog
      </KobalteDialog.Trigger>
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay data-component="dialog-overlay" />
        <Dialog size={props.size} title={props.title} description={props.description}>
          <div style={{ padding: "8px 0" }}>
            <p>Dialog body content goes here. This is the main area of the dialog.</p>
          </div>
        </Dialog>
      </KobalteDialog.Portal>
    </KobalteDialog>
  )
}

export const Normal: Story = {
  render: () => <DialogDemo size="normal" title="Normal Dialog" description="A standard size dialog" />,
}

export const Large: Story = {
  render: () => <DialogDemo size="large" title="Large Dialog" description="A large size dialog" />,
}

export const XLarge: Story = {
  render: () => <DialogDemo size="x-large" title="Extra Large Dialog" description="An extra large dialog" />,
}

export const NoTitle: Story = {
  render: () => <DialogDemo />,
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "12px" }}>
      <DialogDemo size="normal" title="Normal" />
      <DialogDemo size="large" title="Large" />
      <DialogDemo size="x-large" title="X-Large" />
    </div>
  ),
}
