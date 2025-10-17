import type { Meta, StoryObj } from "@storybook/react-vite"
import { LabeledProgress } from "@/components/ui/labeled-progress"
import { createTableStory } from "../src/utils/createTableStory"

const meta = {
	title: "Components/LabeledProgress",
	component: LabeledProgress,
	parameters: {
		layout: "centered",
	},
	tags: ["autodocs"],
	argTypes: {
		label: {
			control: { type: "text" },
		},
		currentValue: {
			control: { type: "number", min: 0 },
		},
		limitValue: {
			control: { type: "number", min: 1 },
		},
		className: {
			control: { type: "text" },
		},
	},
} satisfies Meta<typeof LabeledProgress>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		label: "Storage Used",
		currentValue: 75,
		limitValue: 100,
	},
}

export const Empty: Story = {
	args: {
		label: "No Usage",
		currentValue: 0,
		limitValue: 100,
	},
}

export const ProgressStates = createTableStory({
	component: LabeledProgress,
	rows: {
		currentValue: [0, 50, 100, 120] as const,
	},
	columns: {
		limitValue: [100] as const,
	},
	defaultProps: {
		label: "Progress",
		currentValue: 50,
		limitValue: 100,
	},
	cellClassName: "w-64",
})
