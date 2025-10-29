// kilocode_change - new file
import React from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"

import { MarketplaceView } from "../../../webview-ui/src/components/marketplace/MarketplaceView"

const mockItems = [
	{
		id: "filesystem-mcp",
		name: "File System MCP",
		description: "Provides tools for reading, writing, and managing files and directories on the local filesystem.",
		author: "Anthropic",
		tags: ["files", "filesystem", "core"],
		type: "mcp",
		url: "https://github.com/anthropics/mcp-filesystem",
		content: "npm install @anthropic-ai/mcp-filesystem",
	},
	{
		id: "database-mcp",
		name: "Database MCP",
		description: "Connect to and query various databases including PostgreSQL, MySQL, and SQLite.",
		author: "Community",
		tags: ["database", "sql", "data"],
		type: "mcp",
		url: "https://github.com/community/mcp-database",
		content: "npm install mcp-database",
	},
	{
		id: "architect-mode",
		name: "Architect Mode",
		description: "Plan and design system architecture before implementation. Perfect for complex projects.",
		author: "Kilocode",
		tags: ["planning", "design", "architecture"],
		type: "mode",
		content:
			"slug: architect\nname: Architect\nmodel: anthropic/claude-sonnet-4\nprompt: |\n  You are an experienced software architect.",
	},
	{
		id: "debug-mode",
		name: "Debug Mode",
		description: "Advanced debugging capabilities with step-by-step analysis and error tracking.",
		author: "Kilocode",
		tags: ["debugging", "analysis", "troubleshooting"],
		type: "mode",
		content:
			"slug: debug\nname: Debug\nmodel: anthropic/claude-sonnet-4\nprompt: |\n  You are a debugging specialist.",
	},
]

// Simple mock state manager - using no-op functions to avoid performance issues with action logging
const createMockStateManager = (activeTab: "mcp" | "mode" = "mcp") => ({
	getState: () => ({
		allItems: mockItems,
		organizationMcps: [],
		displayItems: mockItems,
		displayOrganizationMcps: [],
		isFetching: false,
		activeTab,
		filters: {
			type: "",
			search: "",
			tags: [],
			installed: "all",
		},
		installedMetadata: { global: {}, project: {} },
	}),
	transition: () => Promise.resolve(), // No-op async function
	onStateChange: () => () => {}, // Returns unsubscribe function
	cleanup: () => {}, // No-op function
	handleMessage: () => Promise.resolve(), // No-op async function
})

const meta = {
	title: "Marketplace/MarketplaceView",
	component: MarketplaceView,
	argTypes: {
		targetTab: {
			control: { type: "select" },
			options: ["mcp", "mode"],
			description: "Which tab should be active initially",
		},
		hideHeader: {
			control: "boolean",
			description: "Whether to hide the header",
		},
		onDone: {
			action: "onDone",
			description: "Callback when done button is clicked",
		},
	},
	args: {
		hideHeader: false,
		onDone: () => {},
	},
	decorators: [
		(Story) => (
			<div className="w-[300px] min-h-[600px] bg-vscode-sideBar-background">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof MarketplaceView>

export default meta
type Story = StoryObj<typeof meta>

export const MCPTab: Story = {
	args: {
		stateManager: createMockStateManager("mcp") as any,
		targetTab: "mcp",
	},
}

export const ModeTab: Story = {
	args: {
		stateManager: createMockStateManager("mode") as any,
		targetTab: "mode",
	},
}
