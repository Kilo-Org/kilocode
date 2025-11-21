// kilocode_change - new file
import React from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { ShimmerText } from "../../../webview-ui/src/components/ui/shimmer-text"

const meta = {
	title: "Components/ShimmerText",
	component: ShimmerText,
	tags: ["autodocs"],
	argTypes: {
		children: {
			control: "text",
			description: "The text content to display with shimmer effect",
		},
		asChild: {
			control: "boolean",
			description: "Render as child element instead of wrapper span",
		},
	},
	args: {
		children: "API Request...",
	},
	decorators: [
		(Story) => (
			<div className="w-full max-w-4xl mx-auto bg-[var(--vscode-editor-background)] p-8">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ShimmerText>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		children: "API Request...",
	},
}

export const Examples: Story = {
	render: () => (
		<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
			<div style={{ fontSize: "12px" }}>
				<ShimmerText>Small text with shimmer</ShimmerText>
			</div>
			<div style={{ fontSize: "16px" }}>
				<ShimmerText>Normal text with shimmer</ShimmerText>
			</div>
			<div style={{ fontSize: "24px" }}>
				<ShimmerText>Large text with shimmer</ShimmerText>
			</div>
			<ShimmerText>
				<span className="codicon codicon-loading" style={{ marginRight: "8px" }} />
				Loading with icon
			</ShimmerText>
			<ShimmerText>
				<span className="codicon codicon-sparkle" style={{ fontSize: "64px" }} />
			</ShimmerText>
		</div>
	),
}
