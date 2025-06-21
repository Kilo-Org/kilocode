import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "@storybook/test"
import { Button } from "@/components/ui/button"
import { createSimpleStoryTableStory } from "../src/utils/SimpleStoryTable.story-helpers"

const BUTTON_VARIANTS = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const
const BUTTON_SIZES = ["default", "sm", "lg", "icon"] as const
const STORY_TABLE_SIZES = ["default", "sm", "lg"] as const

const meta = {
	title: "Component/Button",
	component: Button,
	parameters: {
		layout: "centered",
	},
	tags: ["autodocs"],
	argTypes: {
		variant: {
			control: { type: "select" },
			options: BUTTON_VARIANTS,
		},
		size: {
			control: { type: "select" },
			options: BUTTON_SIZES,
		},
	},
	args: { onClick: fn() },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		children: "Button",
	},
}

export const Variants = createSimpleStoryTableStory({
	component: Button,
	rows: { variant: BUTTON_VARIANTS },
	columns: { size: STORY_TABLE_SIZES },
	defaultProps: { children: "Button", onClick: fn() },
})

export const States = createSimpleStoryTableStory({
	component: Button,
	rows: { variant: BUTTON_VARIANTS },
	columns: { disabled: [false, true] },
	defaultProps: { children: "Button", onClick: fn() },
})
