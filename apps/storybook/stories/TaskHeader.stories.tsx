import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"

import TaskHeader from "../../../webview-ui/src/components/chat/TaskHeader"
import { createMockTask } from "../src/mockData/clineMessages"
import { withTooltipProvider } from "../src/decorators/withTooltipProvider"

const meta = {
	title: "Roo/TaskHeader",
	component: TaskHeader,
	decorators: [withTooltipProvider],
	args: {
		handleCondenseContext: fn(),
	},
} satisfies Meta<typeof TaskHeader>

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
	},
}
