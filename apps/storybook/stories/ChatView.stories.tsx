// kilocode_change - new file
import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn } from "storybook/test"

import ChatView from "../../../webview-ui/src/components/chat/ChatView"
import { createTaskHeaderMessages, createMockTask } from "../src/mockData/clineMessages"

const meta = {
	title: "Chat/ChatView",
	component: ChatView,
	tags: ["autodocs"],
	argTypes: {
		isHidden: {
			control: "boolean",
			description: "Whether the chat view is hidden",
		},
		showAnnouncement: {
			control: "boolean",
			description: "Whether to show the announcement banner",
		},
		hideAnnouncement: {
			action: "hideAnnouncement",
			description: "Function to hide the announcement",
		},
	},
	args: {
		isHidden: false,
		showAnnouncement: false,
		hideAnnouncement: fn(),
	},
	decorators: [
		(Story) => (
			<div className="min-h-[600px]">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ChatView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		isHidden: false,
		showAnnouncement: false,
		hideAnnouncement: fn(),
	},
	parameters: {
		extensionState: {
			clineMessages: [createMockTask(), ...createTaskHeaderMessages()],
			organizationAllowList: {
				allowAll: true,
				providers: {},
			},
			currentTaskItem: {
				id: "task-1",
				ts: Date.now(),
				task: "Create a React component with TypeScript",
				tokensIn: 1250,
				tokensOut: 850,
				cacheWrites: 45,
				cacheReads: 120,
				totalCost: 0.15,
				conversationStats: {
					messagesTotal: 12,
					messagesEnvironment: 3,
					messagesUser: 2,
					messagesAssistant: 7,
				},
			},
			taskHistory: [
				{
					id: "task-1",
					ts: Date.now() - 3600000,
					task: "Previous completed task",
					tokensIn: 800,
					tokensOut: 600,
					cacheWrites: 20,
					cacheReads: 80,
					totalCost: 0.08,
					conversationStats: {
						messagesTotal: 8,
						messagesEnvironment: 2,
						messagesUser: 1,
						messagesAssistant: 5,
					},
				},
			],
			apiConfiguration: {
				apiProvider: "anthropic",
				apiModelId: "claude-3-5-sonnet-20241022",
				apiKey: "mock-key",
			},
			mcpServers: [],
			allowedCommands: [],
			mode: "code",
			customModes: [],
			gitCommits: [],
			openedTabs: [{ path: "src/components/ChatView.tsx", isDirty: false }],
			filePaths: ["src/components/ChatView.tsx", "package.json", "README.md"],
		},
	},
}
