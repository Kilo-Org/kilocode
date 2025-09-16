import type { Meta, StoryObj } from "@storybook/react-vite"
import { SvgCodeHighlighterExample } from "../src/components/CodeHighlighterExample"

const meta = {
	title: "Autocomplete/SvgCodeHighlighter",
	component: SvgCodeHighlighterExample,
	argTypes: {
		originalText: {
			control: "text",
			description: "Original line of code",
		},
		newText: {
			control: "text",
			description: "New line of code with changes",
		},
		language: {
			control: { type: "select" },
			options: ["typescript", "javascript", "python", "html", "css"],
			description: "Programming language for syntax highlighting",
		},
		fontSize: {
			control: { type: "range", min: 10, max: 24, step: 1 },
			description: "Font size for the rendered text",
		},
		width: {
			control: { type: "range", min: 200, max: 800, step: 50 },
			description: "SVG width",
		},
	},
} satisfies Meta<typeof SvgCodeHighlighterExample>

export default meta
type Story = StoryObj<typeof meta>

export const BasicExample: Story = {
	args: {
		originalText: 'const hello = "hi"',
		newText: 'const hello = "hi";',
		language: "typescript",
		fontSize: 14,
		width: 400,
	},
}

export const MultilineChange: Story = {
	args: {
		originalText: `function sum(a, b) {
	return a + b;
}`,
		newText: `function multiply(x, y) {
	return x * y;
}`,
		language: "typescript",
		fontSize: 14,
		width: 400,
	},
}

export const WordChange: Story = {
	args: {
		originalText: 'const hello = "hi";',
		newText: 'const greeting = "hi";',
		language: "typescript",
		fontSize: 14,
		width: 300,
	},
}

export const SuffixAddition: Story = {
	args: {
		originalText: "ABC",
		newText: "ABCDEF",
		language: "typescript",
		fontSize: 14,
		width: 200,
	},
}

export const MiddleCharacterChange: Story = {
	args: {
		originalText: "abc",
		newText: "acc",
		language: "typescript",
		fontSize: 14,
		width: 200,
	},
}
