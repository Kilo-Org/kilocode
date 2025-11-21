import type { Meta, StoryObj } from "@storybook/react-vite"
import MarkdownBlock from "@/components/common/MarkdownBlock"

const meta = {
	title: "Components/MarkdownBlock",
	component: MarkdownBlock,
	argTypes: {
		markdown: {
			control: { type: "text" },
		},
	},
	args: {
		markdown: `# Markdown Example

This is a **markdown** example with various formatting.

## Features

- **Bold text**
- *Italic text*
- \`Inline code\`
- [Links](https://example.com)

## Code Block

\`\`\`typescript
function example() {
  return "Hello, World!"
}
\`\`\`

## Lists

1. First item
2. Second item
3. Third item

> This is a blockquote`,
	},
} satisfies Meta<typeof MarkdownBlock>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
