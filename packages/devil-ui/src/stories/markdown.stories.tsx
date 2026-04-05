/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Markdown } from "@opencode-ai/ui/markdown"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"

const meta: Meta = {
  title: "Components/Markdown",
  decorators: [
    (Story) => (
      <MarkedProvider>
        <div style={{ "max-width": "600px", padding: "16px" }}>
          <Story />
        </div>
      </MarkedProvider>
    ),
  ],
  parameters: { layout: "padded" },
}

export default meta
type Story = StoryObj

const sampleMarkdown = `# Heading 1

This is a paragraph with **bold** and *italic* text.

## Heading 2

- Item one
- Item two  
- Item three

### Code Example

\`\`\`typescript
const hello = (name: string) => {
  return \`Hello, \${name}!\`
}
\`\`\`

> This is a blockquote with some important information.

Visit [OpenCode](https://opencode.ai) for more details.
`

const shortMarkdown = `Hello **world**! This is *markdown* with \`inline code\`.`

const codeMarkdown = `\`\`\`javascript
function fibonacci(n) {
  if (n <= 1) return n
  return fibonacci(n - 1) + fibonacci(n - 2)
}
\`\`\``

const listMarkdown = `## Features

- AI-powered code generation
- Context-aware suggestions
- Multi-language support
  - TypeScript
  - Python
  - Go
- Real-time collaboration`

export const Default: Story = {
  render: () => <Markdown text={sampleMarkdown} />,
}

export const Short: Story = {
  render: () => <Markdown text={shortMarkdown} />,
}

export const CodeBlock: Story = {
  render: () => <Markdown text={codeMarkdown} />,
}

export const Lists: Story = {
  render: () => <Markdown text={listMarkdown} />,
}
