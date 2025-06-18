import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "@storybook/test"
import { Button } from "@/components/ui/button"

const meta = {
	title: "UI/Button",
	component: Button,
	parameters: {
		layout: "centered",
	},
	tags: ["autodocs"],
	argTypes: {
		variant: {
			control: { type: "select" },
			options: ["default", "destructive", "outline", "secondary", "ghost", "link", "combobox"],
		},
		size: {
			control: { type: "select" },
			options: ["default", "sm", "lg", "icon"],
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

export const Ghost: Story = {
	args: {
		variant: "ghost",
		children: "Ghost",
	},
}

export const Link: Story = {
	args: {
		variant: "link",
		children: "Link",
	},
}

export const Small: Story = {
	args: {
		size: "sm",
		children: "Small",
	},
}

export const Large: Story = {
	args: {
		size: "lg",
		children: "Large",
	},
}

export const Icon: Story = {
	args: {
		size: "icon",
		children: "🚀",
	},
}

export const Disabled: Story = {
	args: {
		disabled: true,
		children: "Disabled",
	},
}

export const WithIcon: Story = {
	args: {
		children: (
			<>
				<span className="codicon codicon-add"></span>
				Add Item
			</>
		),
	},
}
