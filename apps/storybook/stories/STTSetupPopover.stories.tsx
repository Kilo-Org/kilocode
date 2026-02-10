import type { Meta, StoryObj } from "@storybook/react-vite"
import { STTSetupPopoverContent } from "@/components/chat/STTSetupPopover"

const meta = {
	title: "Components/STTSetupPopover",
	component: STTSetupPopoverContent,
	parameters: {
		layout: "centered",
	},
	tags: ["autodocs"],
	render: (args) => (
		<div className="w-[calc(100vw-32px)] max-w-[400px]">
			<STTSetupPopoverContent {...args} />
		</div>
	),
	args: {
		setInputValue: (value: string) => {
			console.log("setInputValue:", value)
		},
		onSend: () => {
			console.log("onSend clicked")
		},
	},
} satisfies Meta<typeof STTSetupPopoverContent>

export default meta
type Story = StoryObj<typeof meta>

export const FFmpegNotInstalled: Story = {
	name: "FFmpeg not installed",
	args: {
		reason: "ffmpegNotInstalled",
		setInputValue: (value: string) => {
			console.log("setInputValue:", value)
		},
		onSend: () => {
			console.log("onSend clicked")
		},
	},
}

export const OpenAIKeyMissing: Story = {
	args: {
		reason: "openaiKeyMissing",
	},
}

export const BothMissing: Story = {}
