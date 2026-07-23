/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { StoryProviders } from "./StoryProviders"

const meta: Meta = {
  title: "Chat/Inline Chart Prototype",
  parameters: { layout: "padded" },
}

export default meta
type Story = StoryObj

const text = `Chart rendered inline from a fenced JSON block:

\`\`\`chart
{
  "type": "bar",
  "data": {
    "labels": ["Mon", "Tue", "Wed", "Thu", "Fri"],
    "datasets": [{
      "label": "Sessions",
      "data": [12, 19, 8, 15, 23],
      "backgroundColor": "#5b8def"
    }]
  }
}
\`\`\``

export const BarChart: Story = {
  render: () => (
    <StoryProviders>
      <Markdown text={text} />
    </StoryProviders>
  ),
}
