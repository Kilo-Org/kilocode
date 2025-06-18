import type { Meta, StoryObj } from "@storybook/react"
import { Badge } from "@/components/ui/badge"

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
			options: ["default", "secondary", "destructive", "outline"],
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

export const Secondary: Story = {
	args: {
		variant: "secondary",
		children: "Secondary",
	},
}

export const Destructive: Story = {
	args: {
		variant: "destructive",
		children: "Destructive",
	},
}

export const Outline: Story = {
	args: {
		variant: "outline",
		children: "Outline",
	},
}

export const WithIcon: Story = {
	args: {
		children: (
			<>
				<span className="codicon codicon-check"></span>
				Success
			</>
		),
	},
}

export const LongText: Story = {
	args: {
		children: "This is a longer badge text",
	},
}

export const Number: Story = {
	args: {
		children: "42",
	},
}
