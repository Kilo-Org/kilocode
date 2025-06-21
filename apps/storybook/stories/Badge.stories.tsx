import type { Meta, StoryObj } from "@storybook/react"
import { Badge } from "@/components/ui/badge"
import { createSimpleStoryTableStory } from "../src/utils/SimpleStoryTable.story-helpers"

const BADGE_VARIANTS = ["default", "secondary", "destructive", "outline"] as const

const meta = {
	title: "UI/Badge",
	component: Badge,
	parameters: {
		layout: "centered",
	},
	tags: ["autodocs"],
	argTypes: {
		variant: {
			control: { type: "select" },
			options: BADGE_VARIANTS,
		},
	},
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		children: "Badge",
	},
}

export const Variants = createSimpleStoryTableStory({
	component: Badge,
	rows: { variant: BADGE_VARIANTS },
	columns: { children: ["Badge", "42", "This is a longer badge text"] },
	cellClassName: "p-4",
})
