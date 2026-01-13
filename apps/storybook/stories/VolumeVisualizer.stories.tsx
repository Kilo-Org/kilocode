import type { Meta, StoryObj } from "@storybook/react-vite"
import { VolumeVisualizer } from "@/components/chat/VolumeVisualizer"

const meta = {
	title: "Components/VolumeVisualizer",
	component: VolumeVisualizer,
	parameters: {
		layout: "centered",
	},
	argTypes: {
		volume: {
			control: { type: "range", min: 0, max: 1, step: 0.01 },
			description: "Volume level from 0 to 1",
		},
		isActive: {
			control: "boolean",
			description: "Whether recording is active (affects color)",
		},
	},
} satisfies Meta<typeof VolumeVisualizer>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		volume: 0.5,
		isActive: true,
	},
}

export const Inactive: Story = {
	args: {
		volume: 0.3,
		isActive: false,
	},
}
