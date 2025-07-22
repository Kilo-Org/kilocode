import type { Meta, StoryObj } from "@storybook/react"
import AutoApproveMenu from "../../../webview-ui/src/components/chat/AutoApproveMenu"
import { withLimitedWidth } from "../src/decorators/withLimitedWidth"

const meta: Meta<typeof AutoApproveMenu> = {
	title: "Chat/AutoApproveMenu",
	component: AutoApproveMenu,
	decorators: [withLimitedWidth(400)],
}

export default meta
type Story = StoryObj<typeof AutoApproveMenu>

export const Collapsed: Story = {}

export const Expanded: Story = {
	args: {
		initialExpanded: true,
	},
}
