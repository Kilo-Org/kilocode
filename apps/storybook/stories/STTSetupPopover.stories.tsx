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
		onFfmpegHelpClick: () => {
			console.log("FFmpeg help clicked")
		},
	},
} satisfies Meta<typeof STTSetupPopoverContent>

export default meta
type Story = StoryObj<typeof meta>

export const FFmpegNotInstalled: Story = {
	name: "FFmpeg not installed",
	args: {
		reason: "ffmpegNotInstalled",
		onFfmpegHelpClick: () => {
			console.log("FFmpeg help clicked")
		},
	},
}

export const OpenAIKeyMissing: Story = {
	args: {
		reason: "openaiKeyMissing",
	},
}

export const BothMissing: Story = {}
