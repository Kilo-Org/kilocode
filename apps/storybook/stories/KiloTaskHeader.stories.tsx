import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"

import KiloTaskHeader from "../../../webview-ui/src/components/kilocode/KiloTaskHeader"
import { createTaskHeaderMessages, createMockTask } from "../src/mockData/clineMessages"
import { withTooltipProvider } from "../src/decorators/withTooltipProvider"
import { withExtensionState } from "../src/decorators/withExtensionState"

const meta = {
	title: "Chat/KiloTaskHeader",
	component: KiloTaskHeader,
	decorators: [withTooltipProvider, withExtensionState],
	argTypes: {},
	args: {
		handleCondenseContext: fn(),
		onClose: fn(),
		onMessageClick: fn(),
	},
} satisfies Meta<typeof KiloTaskHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		task: createMockTask(),
		tokensIn: 1250,
		tokensOut: 850,
		cacheWrites: 45,
		cacheReads: 120,
		totalCost: 0.15,
		contextTokens: 15000,
		buttonsDisabled: false,
		handleCondenseContext: fn(),
		onClose: fn(),
		groupedMessages: createTaskHeaderMessages(),
		onMessageClick: fn(),
		isTaskActive: true,
	},
	parameters: {
		extensionState: {
			showTaskTimeline: true,
		},
	},
}

export const WithoutTimeline: Story = {
	args: {
		...Default.args,
		groupedMessages: [],
	},
	parameters: {
		extensionState: {
			showTaskTimeline: false,
		},
	},
}

export const NearContextLimit: Story = {
	args: {
		...Default.args,
		contextTokens: 95000,
	},
	parameters: {
		extensionState: {
			showTaskTimeline: true,
		},
	},
}
