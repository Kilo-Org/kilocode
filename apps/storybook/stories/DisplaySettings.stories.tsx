import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"
import { DisplaySettings } from "../../../webview-ui/src/components/settings/DisplaySettings"

const meta = {
	title: "Settings/DisplaySettings",
	component: DisplaySettings,
	parameters: {
		layout: "padded",
	},
	tags: ["autodocs"],
	argTypes: {
		showTaskTimeline: {
			control: { type: "boolean" },
			description: "Whether the task timeline is enabled",
		},
	},
	args: {
		setCachedStateField: fn(),
	},
} satisfies Meta<typeof DisplaySettings>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
