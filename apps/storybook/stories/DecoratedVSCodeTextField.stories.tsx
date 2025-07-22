import type { Meta, StoryObj } from "@storybook/react"
import { DecoratedVSCodeTextField } from "../../../webview-ui/src/components/common/DecoratedVSCodeTextField"

const meta: Meta<typeof DecoratedVSCodeTextField> = {
	title: "Component/DecoratedVSCodeTextField",
	component: DecoratedVSCodeTextField,
	parameters: {
		layout: "centered",
	},
	tags: ["autodocs"],
	argTypes: {
		placeholder: {
			control: "text",
			description: "Placeholder text for the input",
		},
		value: {
			control: "text",
			description: "Current value of the input",
		},
		disabled: {
			control: "boolean",
			description: "Whether the input is disabled",
		},
		leftNodes: {
			control: false,
			description: "Array of React nodes to display on the left side of the input",
		},
		rightNodes: {
			control: false,
			description: "Array of React nodes to display on the right side of the input",
		},
	},
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		value: "",
		placeholder: "Enter text...",
	},
}

export const WithBothNodes: Story = {
	args: {
		value: "",
		placeholder: "0.00",
		leftNodes: [<span key="dollar">$</span>],
		rightNodes: [<span key="usd">USD</span>],
	},
}

export const PriceInput: Story = {
	name: "Price Input Example",
	args: {
		placeholder: "0.00",
		leftNodes: [<span key="dollar">$</span>],
		rightNodes: [<span key="usd">USD</span>],
		value: "25.99",
	},
}

export const SearchInput: Story = {
	name: "Search Input Example",
	args: {
		value: "",
		placeholder: "Search files...",
		leftNodes: [<span key="search">🔍</span>],
		rightNodes: [
			<span key="shortcut" style={{ fontSize: "11px", opacity: 0.7 }}>
				⌘K
			</span>,
		],
	},
}

export const Disabled: Story = {
	args: {
		placeholder: "Disabled input",
		leftNodes: [<span key="dollar">$</span>],
		disabled: true,
		value: "100.00",
	},
}
