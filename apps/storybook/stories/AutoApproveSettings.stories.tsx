import type { Meta, StoryObj } from "@storybook/react"
import { AutoApproveSettings } from "../../../webview-ui/src/components/settings/AutoApproveSettings"
import { withLimitedWidth } from "../src/decorators/withLimitedWidth"

const meta: Meta<typeof AutoApproveSettings> = {
	title: "Settings/AutoApproveSettings",
	component: AutoApproveSettings,
	decorators: [withLimitedWidth(600)],
}

export default meta
type Story = StoryObj<typeof AutoApproveSettings>

export const Default: Story = {
	args: {},
}
