/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Typewriter } from "@opencode-ai/ui/typewriter"

const meta: Meta = {
  title: "Components/Typewriter",
  parameters: { layout: "centered" },
}

export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => <Typewriter text="Hello, world! This is a typewriter effect." />,
}

export const Short: Story = {
  render: () => <Typewriter text="Hi!" />,
}

export const Long: Story = {
  render: () => (
    <Typewriter text="The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs." />
  ),
}

export const AsHeading: Story = {
  render: () => <Typewriter as="h2" text="Welcome to Kilo" />,
}

export const WithClass: Story = {
  render: () => <Typewriter text="Styled text" class="text-lg font-bold" />,
}
