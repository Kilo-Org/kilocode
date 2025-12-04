import type { Meta, StoryObj } from "@storybook/react-vite"
import TelemetryBanner from "../../../webview-ui/src/components/common/TelemetryBanner"

const meta = {
	title: "System/TelemetryBanner",
	component: TelemetryBanner,
	tags: ["autodocs"],
} satisfies Meta<typeof TelemetryBanner>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
