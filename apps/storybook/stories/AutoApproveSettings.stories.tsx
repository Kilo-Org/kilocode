import type { Meta, StoryObj } from "@storybook/react"
import { AutoApproveSettings } from "../../../webview-ui/src/components/settings/AutoApproveSettings"

const meta: Meta<typeof AutoApproveSettings> = {
	title: "Settings/AutoApproveSettings",
	component: AutoApproveSettings,
	decorators: [
		(Story) => (
			<div style={{ maxWidth: "600px", margin: "0 auto" }}>
				<Story />
			</div>
		),
	],
}

export default meta
type Story = StoryObj<typeof AutoApproveSettings>

export const Default: Story = {
	args: {},
}
