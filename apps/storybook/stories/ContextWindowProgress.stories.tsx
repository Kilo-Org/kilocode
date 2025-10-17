import type { Meta, StoryObj } from "@storybook/react-vite"

import { ContextWindowProgress } from "../../../webview-ui/src/components/chat/ContextWindowProgress"
import { TooltipProvider } from "../../../webview-ui/src/components/ui/tooltip"

const meta = {
	title: "Chat/ContextWindowProgress",
	component: ContextWindowProgress,
	decorators: [
		(Story) => (
			<TooltipProvider delayDuration={300}>
				<Story />
			</TooltipProvider>
		),
	],
	parameters: {
		layout: "padded",
	},
	tags: ["autodocs"],
	argTypes: {
		contextWindow: {
			control: { type: "number" },
			description: "Total context window size in tokens",
		},
		contextTokens: {
			control: { type: "number" },
			description: "Current tokens used in context",
		},
		maxTokens: {
			control: { type: "number" },
			description: "Maximum tokens reserved for model output",
		},
	},
} satisfies Meta<typeof ContextWindowProgress>

export default meta
type Story = StoryObj<typeof meta>

export const UnderLimit: Story = {
	args: {
		contextWindow: 128000,
		contextTokens: 45000, // ~35% usage
		maxTokens: 4096,
	},
}

export const OverLimit: Story = {
	args: {
		contextWindow: 128000,
		contextTokens: 75000, // ~59% usage
		maxTokens: 4096,
	},
}
