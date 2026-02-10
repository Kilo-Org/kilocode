import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"
import { MicrophoneButton } from "@/components/chat/MicrophoneButton"
import { createTableStory } from "../src/utils/createTableStory"

const meta = {
	title: "Components/MicrophoneButton",
	component: MicrophoneButton,
	parameters: {
		layout: "centered",
		backgrounds: {
			default: "dark",
			values: [{ name: "dark", value: "#1e1e1e" }],
		},
	},
	args: {
		isRecording: false,
		disabled: false,
		hasError: false,
		onClick: fn(),
		onStatusChange: fn(),
	},
} satisfies Meta<typeof MicrophoneButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const States = createTableStory({
	component: MicrophoneButton,
	rows: {
		isRecording: [false, true],
	},
	columns: {
		disabled: [false, true],
		hasError: [false, true],
	},
	defaultProps: {
		onClick: fn(),
		onStatusChange: fn(),
	},
})
