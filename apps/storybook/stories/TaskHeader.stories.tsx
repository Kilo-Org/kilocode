import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "@storybook/test"

import TaskHeader from "../../../webview-ui/src/components/chat/TaskHeader"
import { createTaskHeaderMessages, createMockTask } from "../src/mockData/clineMessages"

const meta = {
	title: "Chat/TaskHeader",
	component: TaskHeader,
	parameters: {
		layout: "padded",
	},
	tags: ["autodocs"],
	argTypes: {},
	args: {
		handleCondenseContext: fn(),
		onClose: fn(),
		onMessageClick: fn(),
	},
} satisfies Meta<typeof TaskHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		task: createMockTask(),
		tokensIn: 1250,
		tokensOut: 850,
		doesModelSupportPromptCache: true,
		cacheWrites: 45,
		cacheReads: 120,
		totalCost: 0.15,
		contextTokens: 15000,
		buttonsDisabled: false,
		handleCondenseContext: fn(),
		onClose: fn(),
		groupedMessages: createTaskHeaderMessages(),
		onMessageClick: fn(),
		currentMessageIndex: 4,
		isTaskActive: true,
	},
}
