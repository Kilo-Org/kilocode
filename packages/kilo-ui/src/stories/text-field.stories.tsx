/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { TextField } from "@opencode-ai/ui/text-field"

const meta: Meta<typeof TextField> = {
  title: "Components/TextField",
  component: TextField,
  argTypes: {
    variant: { control: "select", options: ["normal", "ghost"] },
    disabled: { control: "boolean" },
    multiline: { control: "boolean" },
  },
  decorators: [
    (Story) => (
      <div style={{ width: "320px" }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof TextField>

export const Normal: Story = {
  args: { variant: "normal", placeholder: "Enter text..." },
}

export const Ghost: Story = {
  args: { variant: "ghost", placeholder: "Ghost input..." },
}

export const WithLabel: Story = {
  args: { label: "Full Name", placeholder: "John Doe" },
}

export const WithDescription: Story = {
  args: { label: "API Key", description: "Your secret API key", placeholder: "sk-..." },
}

export const WithError: Story = {
  args: {
    label: "Email",
    placeholder: "user@example.com",
    validationState: "invalid",
    error: "Invalid email address",
  },
}

export const Multiline: Story = {
  args: { label: "Message", multiline: true, placeholder: "Enter a longer message..." },
}

export const Copyable: Story = {
  args: { label: "API Token", value: "tok_abc123xyz456", copyable: true, readOnly: true },
}

export const CopyableLink: Story = {
  args: {
    label: "Share URL",
    value: "https://example.com/share/abc123",
    copyable: true,
    copyKind: "link",
    readOnly: true,
  },
}

export const Disabled: Story = {
  args: { label: "Disabled Field", value: "Can't edit this", disabled: true },
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px", width: "320px" }}>
      <TextField variant="normal" placeholder="Normal input" />
      <TextField variant="ghost" placeholder="Ghost input" />
      <TextField label="With Label" placeholder="Enter value" />
      <TextField label="With Error" validationState="invalid" error="Required field" placeholder="Missing" />
      <TextField label="Multiline" multiline placeholder="Type here..." />
      <TextField label="Copyable" value="copy-me-value" copyable readOnly />
    </div>
  ),
}
