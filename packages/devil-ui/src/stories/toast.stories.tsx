/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Toast, showToast } from "@opencode-ai/ui/toast"
import { Button } from "@opencode-ai/ui/button"

const meta: Meta = {
  title: "Components/Toast",
  decorators: [
    (Story) => (
      <>
        <Toast.Region />
        <Story />
      </>
    ),
  ],
  parameters: { layout: "centered" },
}

export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => (
    <Button variant="secondary" onClick={() => showToast({ description: "This is a default toast" })}>
      Show Toast
    </Button>
  ),
}

export const Success: Story = {
  render: () => (
    <Button
      variant="secondary"
      onClick={() =>
        showToast({ title: "Success!", description: "Operation completed successfully", variant: "success" })
      }
    >
      Show Success Toast
    </Button>
  ),
}

export const Error: Story = {
  render: () => (
    <Button
      variant="secondary"
      onClick={() =>
        showToast({ title: "Error", description: "Something went wrong. Please try again.", variant: "error" })
      }
    >
      Show Error Toast
    </Button>
  ),
}

export const Loading: Story = {
  render: () => (
    <Button
      variant="secondary"
      onClick={() => showToast({ description: "Loading...", variant: "loading", persistent: true })}
    >
      Show Loading Toast
    </Button>
  ),
}

export const WithActions: Story = {
  render: () => (
    <Button
      variant="secondary"
      onClick={() =>
        showToast({
          title: "File deleted",
          description: "report.pdf has been moved to trash",
          actions: [
            { label: "Undo", onClick: () => console.log("Undo!") },
            { label: "Dismiss", onClick: "dismiss" },
          ],
        })
      }
    >
      Show Toast with Actions
    </Button>
  ),
}

export const WithIcon: Story = {
  render: () => (
    <Button
      variant="secondary"
      onClick={() => showToast({ description: "Session saved", variant: "success", icon: "check" })}
    >
      Show Toast with Icon
    </Button>
  ),
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
      <Button variant="secondary" onClick={() => showToast({ description: "Default toast" })}>
        Default
      </Button>
      <Button variant="secondary" onClick={() => showToast({ description: "Success!", variant: "success" })}>
        Success
      </Button>
      <Button variant="secondary" onClick={() => showToast({ description: "Error occurred", variant: "error" })}>
        Error
      </Button>
      <Button variant="secondary" onClick={() => showToast({ description: "Loading...", variant: "loading" })}>
        Loading
      </Button>
    </div>
  ),
}
