/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { ImagePreview } from "@opencode-ai/ui/image-preview"
import { Button } from "@opencode-ai/ui/button"

const meta: Meta = {
  title: "Components/ImagePreview",
  parameters: { layout: "centered" },
}

export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => (
    <Kobalte>
      <Kobalte.Trigger as={Button}>Open Image Preview</Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Overlay />
        <ImagePreview
          src="https://via.placeholder.com/800x600/3b82f6/ffffff?text=Sample+Image"
          alt="Sample placeholder image"
        />
      </Kobalte.Portal>
    </Kobalte>
  ),
}

export const WithLandscapeImage: Story = {
  render: () => (
    <Kobalte>
      <Kobalte.Trigger as={Button}>Open Landscape Image</Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Overlay />
        <ImagePreview
          src="https://via.placeholder.com/1200x400/10b981/ffffff?text=Landscape+Image"
          alt="Landscape image"
        />
      </Kobalte.Portal>
    </Kobalte>
  ),
}

export const WithPortraitImage: Story = {
  render: () => (
    <Kobalte>
      <Kobalte.Trigger as={Button}>Open Portrait Image</Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Overlay />
        <ImagePreview
          src="https://via.placeholder.com/400x800/f59e0b/ffffff?text=Portrait+Image"
          alt="Portrait image"
        />
      </Kobalte.Portal>
    </Kobalte>
  ),
}
