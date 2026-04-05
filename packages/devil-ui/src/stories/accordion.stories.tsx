/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Accordion } from "@opencode-ai/ui/accordion"

const meta: Meta = {
  title: "Components/Accordion",
  decorators: [
    (Story) => (
      <div style={{ width: "400px" }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => (
    <Accordion collapsible defaultValue={["item-1"]}>
      <Accordion.Item value="item-1">
        <Accordion.Header>
          <Accordion.Trigger>What is Kilo?</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content>
          <div style={{ padding: "8px 16px" }}>
            Kilo is an AI-powered coding assistant that helps you write, debug, and understand code.
          </div>
        </Accordion.Content>
      </Accordion.Item>
      <Accordion.Item value="item-2">
        <Accordion.Header>
          <Accordion.Trigger>How does it work?</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content>
          <div style={{ padding: "8px 16px" }}>
            Kilo uses large language models to understand your codebase and provide intelligent suggestions.
          </div>
        </Accordion.Content>
      </Accordion.Item>
      <Accordion.Item value="item-3">
        <Accordion.Header>
          <Accordion.Trigger>What languages are supported?</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content>
          <div style={{ padding: "8px 16px" }}>
            Kilo supports all major programming languages including TypeScript, Python, Go, Rust, and more.
          </div>
        </Accordion.Content>
      </Accordion.Item>
    </Accordion>
  ),
}

export const Multiple: Story = {
  render: () => (
    <Accordion multiple defaultValue={["item-1", "item-2"]}>
      <Accordion.Item value="item-1">
        <Accordion.Header>
          <Accordion.Trigger>Section One</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content>
          <div style={{ padding: "8px 16px" }}>Content for section one.</div>
        </Accordion.Content>
      </Accordion.Item>
      <Accordion.Item value="item-2">
        <Accordion.Header>
          <Accordion.Trigger>Section Two</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content>
          <div style={{ padding: "8px 16px" }}>Content for section two.</div>
        </Accordion.Content>
      </Accordion.Item>
      <Accordion.Item value="item-3">
        <Accordion.Header>
          <Accordion.Trigger>Section Three</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content>
          <div style={{ padding: "8px 16px" }}>Content for section three.</div>
        </Accordion.Content>
      </Accordion.Item>
    </Accordion>
  ),
}
