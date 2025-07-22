import type { Meta, StoryObj } from "@storybook/react"
import AutoApproveMenu from "../../../webview-ui/src/components/chat/AutoApproveMenu"

const meta: Meta<typeof AutoApproveMenu> = {
	title: "Chat/AutoApproveMenu",
	component: AutoApproveMenu,
	parameters: {
		layout: "padded",
	},
	decorators: [
		(Story) => (
			<div style={{ maxWidth: "400px", margin: "0 auto" }}>
				<Story />
			</div>
		),
	],
}

export default meta
type Story = StoryObj<typeof AutoApproveMenu>

export const Collapsed: Story = {}

export const Expanded: Story = {
	args: {
		initialExpanded: true,
	},
}
