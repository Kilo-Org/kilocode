/** @jsxImportSource solid-js */
import { createSignal } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { InlineInput } from "@opencode-ai/ui/inline-input"

const meta: Meta<typeof InlineInput> = {
  title: "Components/InlineInput",
  component: InlineInput,
}

export default meta
type Story = StoryObj<typeof InlineInput>

export const Default: Story = {
  args: { placeholder: "Enter value..." },
}

export const WithWidth: Story = {
  args: { placeholder: "120px wide", width: "120px" },
}

export const Disabled: Story = {
  args: { value: "Read only value", disabled: true },
}

export const Controlled: Story = {
  render: () => {
    const [val, setVal] = createSignal("editable text")
    return (
      <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
        <InlineInput value={val()} onInput={(e) => setVal(e.currentTarget.value)} />
        <span style={{ "font-size": "12px", color: "var(--text-weak)" }}>Value: {val()}</span>
      </div>
    )
  },
}
