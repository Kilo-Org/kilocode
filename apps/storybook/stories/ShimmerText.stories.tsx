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
		foregroundColor: {
			control: "color",
			description: "Custom foreground/base color for the shimmer",
		},
		highlightColor: {
			control: "color",
			description: "Custom highlight color for the shimmer effect",
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

			<div style={{ marginTop: "8px" }}>
				<strong style={{ color: "var(--vscode-foreground)" }}>Custom colors via props:</strong>
			</div>
			<ShimmerText foregroundColor="#3b82f6" style={{ fontSize: "18px" }}>
				Blue (foreground only, highlight auto-generated)
			</ShimmerText>
			<ShimmerText foregroundColor="#6366f1" highlightColor="#c4b5fd" style={{ fontSize: "18px" }}>
				Purple with custom highlight
			</ShimmerText>

			<div style={{ marginTop: "8px" }}>
				<strong style={{ color: "var(--vscode-foreground)" }}>CSS variables from parent:</strong>
			</div>
			<div
				style={
					{
						"--shimmer-foreground": "#059669",
						"--shimmer-highlight-color": "#a7f3d0",
						padding: "12px",
						border: "1px solid var(--vscode-panel-border)",
						borderRadius: "4px",
					} as React.CSSProperties
				}>
				<ShimmerText style={{ fontSize: "18px" }}>Inherits green from parent container</ShimmerText>
			</div>
		</div>
	),
}
