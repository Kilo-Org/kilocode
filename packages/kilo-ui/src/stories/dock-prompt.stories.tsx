/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { DockPrompt } from "@opencode-ai/ui/dock-prompt"
import { Button } from "@opencode-ai/ui/button"

const meta: Meta = {
  title: "Components/DockPrompt",
  parameters: { layout: "padded" },
}
export default meta
type Story = StoryObj

export const Question: Story = {
  name: "Question kind",
  render: () => (
    <div style={{ width: "420px" }}>
      <DockPrompt
        kind="question"
        header={<span style={{ "font-weight": "600" }}>Which testing framework should I use?</span>}
        footer={
          <div style={{ display: "flex", gap: "8px" }}>
            <Button variant="ghost" size="small">
              Dismiss
            </Button>
            <Button variant="primary" size="small">
              Submit
            </Button>
          </div>
        }
      >
        <div style={{ padding: "8px 0" }}>
          <p style={{ margin: 0, "font-size": "13px" }}>Choose one of the following options:</p>
          <ul style={{ margin: "8px 0 0", padding: "0 0 0 16px", "font-size": "13px" }}>
            <li>Vitest</li>
            <li>Jest</li>
            <li>Playwright</li>
            <li>Bun test</li>
          </ul>
        </div>
      </DockPrompt>
    </div>
  ),
}

export const Permission: Story = {
  name: "Permission kind",
  render: () => (
    <div style={{ width: "420px" }}>
      <DockPrompt
        kind="permission"
        header={<span style={{ "font-weight": "600" }}>Permission required — write</span>}
        footer={
          <div style={{ display: "flex", gap: "8px" }}>
            <Button variant="ghost" size="small">
              Deny
            </Button>
            <Button variant="secondary" size="small">
              Always Allow
            </Button>
            <Button variant="primary" size="small">
              Allow Once
            </Button>
          </div>
        }
      >
        <div style={{ padding: "8px 0", "font-size": "13px" }}>
          <code>src/main.tsx</code>
          <br />
          <code>src/utils.ts</code>
        </div>
      </DockPrompt>
    </div>
  ),
}
